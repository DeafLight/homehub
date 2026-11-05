// Horaires théoriques Irigo (GTFS, transport.data.gouv.fr) : position des arrêts, lignes qui y passent, et courses
// de chaque jour. Sert à la page « Transports » (arrêts proches d'une adresse, lignes directes entre deux lieux, temps
// de marche estimé) et au trajet calé sur l'emploi du temps (quelle course prendre pour arriver avant le 1er cours).
// Le temps réel (SIRI, irigo.ts) ne donne ni la position des arrêts ni les courses au-delà de l'heure qui vient.
// L'archive est téléchargée au plus une fois par semaine et gardée dans le dossier d'état.
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import type { RouteOption, StopChoice } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import { lineLabel } from './irigo.ts';
import type { SourceStatus } from './source-status.ts';
import type { Clock } from './types.ts';

/** Jeu « Réseau urbain Irigo » de transport.data.gouv.fr (lien stable de data.gouv.fr). */
export const GTFS_URL = 'https://www.data.gouv.fr/api/1/datasets/r/32f30b64-33f7-43bb-9b6f-34c21c2f83a3';
const REFRESH_MS = 7 * 86_400_000;
const RETRY_MS = 6 * 3_600_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Marche : vitesse (≈ 4,5 km/h) et détour des rues par rapport à la ligne droite. */
const WALK_METERS_PER_MINUTE = 75;
const STREET_DETOUR = 1.3;
/** Arrêts considérés comme « proches » d'un lieu. */
const NEAR_METERS = 800;

// --- Archive zip et CSV --------------------------------------------------------------------------------------

/** Fichiers d'une archive zip (stockés ou compressés « deflate »), lus par son répertoire central. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('archive zip illisible');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('archive zip illisible');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRawSync(data));
    at += 46 + nameLength + extra;
  }
  return files;
}

/** Lignes d'un CSV GTFS, en objets indexés par l'en-tête (guillemets gérés). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) rows.push([...row, field]);
  const [header = [], ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

// --- Index des horaires -----------------------------------------------------------------------------------------

export type GtfsStop = { id: string; name: string; lat: number; lon: number };
/** Arrêt avec ses lignes et les destinations des courses qui en partent (pour distinguer les deux quais). */
export type StopInfo = StopChoice;
export type NearStop = StopInfo & { meters: number; walkMinutes: number };
/** Une course de la ligne : départ de l'arrêt d'origine, arrivée à l'arrêt de destination. */
export type Trip = { departs: Date; arrives: Date };
export type LatLon = { lat: number; lon: number };

type TripRow = { line: string; service: string; headsign: string; stops: string[]; times: Int32Array };
type Service = { days: boolean[]; start: string; end: string };

export type GtfsIndex = {
  stop(id: string): StopInfo | undefined;
  /** Arrêts à moins de `meters` (à vol d'oiseau), du plus proche au plus loin. */
  nearby(point: LatLon, meters?: number, limit?: number): NearStop[];
  /** Arrêts dont le nom contient `query` (sans accents ni casse). */
  search(query: string, limit?: number): StopInfo[];
  /** Lignes directes entre les deux lieux, de la plus rapide (marche comprise) à la plus lente ; une par ligne. */
  routes(from: LatLon, to: LatLon, limit?: number): RouteOption[];
  /** Courses du jour `day` (date locale) de la ligne, de `origin` à `destination`, triées par départ. */
  trips(route: { line: string; origin: string; destination: string }, day: Date): Trip[];
};

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Secondes depuis minuit (« 25:10:00 » : le lendemain, à 1 h 10). */
const seconds = (time: string) => {
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};

/** Distance à vol d'oiseau, en mètres. */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Temps de marche estimé, en minutes entières (au moins 1) : ligne droite + 30 % de détour, à 75 m/min. */
export const walkMinutes = (meters: number) => Math.max(1, Math.ceil((meters * STREET_DETOUR) / WALK_METERS_PER_MINUTE));

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const mostCommon = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** Construit l'index à partir des fichiers de l'archive. */
export function buildGtfsIndex(files: Map<string, Buffer>): GtfsIndex {
  const csv = (name: string) => {
    const file = files.get(name);
    return file ? parseCsv(file.toString('utf8')) : [];
  };
  const stops = new Map<string, GtfsStop>();
  for (const s of csv('stops.txt')) {
    if (s.location_type && s.location_type !== '0') continue;
    stops.set(s.stop_id, { id: s.stop_id, name: s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon) });
  }
  const lineOf = new Map(csv('routes.txt').map((r) => [r.route_id, lineLabel(r.route_short_name || r.route_id)]));
  const trips = new Map<string, TripRow>();
  for (const t of csv('trips.txt')) {
    trips.set(t.trip_id, { line: lineOf.get(t.route_id) ?? lineLabel(t.route_id), service: t.service_id, headsign: t.trip_headsign, stops: [], times: new Int32Array(0) });
  }
  const calls = new Map<string, { seq: number; stop: string; time: number }[]>();
  for (const st of csv('stop_times.txt')) {
    const time = st.departure_time || st.arrival_time;
    if (!time || !trips.has(st.trip_id)) continue;
    let list = calls.get(st.trip_id);
    if (!list) calls.set(st.trip_id, (list = []));
    list.push({ seq: Number(st.stop_sequence), stop: st.stop_id, time: seconds(time) });
  }
  for (const [id, list] of calls) {
    list.sort((a, b) => a.seq - b.seq);
    const trip = trips.get(id) as TripRow;
    trip.stops = list.map((c) => c.stop);
    trip.times = Int32Array.from(list.map((c) => c.time));
  }
  const services = new Map<string, Service>();
  const DAY_COLUMNS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const c of csv('calendar.txt')) {
    services.set(c.service_id, { days: DAY_COLUMNS.map((d) => c[d] === '1'), start: c.start_date, end: c.end_date });
  }
  const exceptions = new Map<string, Map<string, boolean>>();
  for (const e of csv('calendar_dates.txt')) {
    let dates = exceptions.get(e.service_id);
    if (!dates) exceptions.set(e.service_id, (dates = new Map()));
    dates.set(e.date, e.exception_type === '1');
  }
  const runsOn = (service: string, day: Date) => {
    const date = ymd(day);
    const exception = exceptions.get(service)?.get(date);
    if (exception !== undefined) return exception;
    const s = services.get(service);
    return Boolean(s && s.start <= date && date <= s.end && s.days[day.getDay()]);
  };

  // Lignes et destinations de chaque arrêt, et courses qui y passent (index de recherche des lignes directes).
  const tripsAt = new Map<string, TripRow[]>();
  const linesAt = new Map<string, Set<string>>();
  const towardsAt = new Map<string, string[]>();
  for (const trip of trips.values()) {
    trip.stops.forEach((stop, i) => {
      if (i === trip.stops.length - 1) return; // terminus : on n'y monte pas
      let list = tripsAt.get(stop);
      if (!list) tripsAt.set(stop, (list = []));
      list.push(trip);
      let lines = linesAt.get(stop);
      if (!lines) linesAt.set(stop, (lines = new Set()));
      lines.add(trip.line);
      let towards = towardsAt.get(stop);
      if (!towards) towardsAt.set(stop, (towards = []));
      towards.push(trip.headsign);
    });
  }
  const sortLines = (lines: Iterable<string>) => [...lines].sort((a, b) => a.length - b.length || a.localeCompare(b, 'fr', { numeric: true }));
  const info = (stop: GtfsStop): StopInfo => {
    const towards = towardsAt.get(stop.id) ?? [];
    const counts = new Map<string, number>();
    for (const t of towards) counts.set(t, (counts.get(t) ?? 0) + 1);
    return {
      ...stop,
      lines: sortLines(linesAt.get(stop.id) ?? []),
      towards: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t).filter(Boolean),
    };
  };
  const served = [...stops.values()].filter((s) => tripsAt.has(s.id));

  function nearby(point: LatLon, meters = NEAR_METERS, limit = 8): NearStop[] {
    return served
      .map((s) => ({ stop: s, meters: distanceMeters(point, s) }))
      .filter((s) => s.meters <= meters)
      .sort((a, b) => a.meters - b.meters)
      .slice(0, limit)
      .map(({ stop, meters: m }) => ({ ...info(stop), meters: Math.round(m), walkMinutes: walkMinutes(m) }));
  }

  return {
    stop: (id) => {
      const s = stops.get(id);
      return s && info(s);
    },
    nearby,
    search(query, limit = 12) {
      const q = normalize(query.trim());
      if (q.length < 2) return [];
      return served
        .filter((s) => normalize(s.name).includes(q))
        .sort((a, b) => Number(!normalize(b.name).startsWith(q)) - Number(!normalize(a.name).startsWith(q)) || a.name.localeCompare(b.name, 'fr'))
        .slice(0, limit)
        .map(info);
    },
    routes(from, to, limit = 5) {
      const starts = nearby(from, NEAR_METERS, 30);
      const ends = new Map(nearby(to, NEAR_METERS, 30).map((s) => [s.id, s]));
      type Base = Omit<RouteOption, 'rideMinutes' | 'towards' | 'headsigns' | 'oneWay' | 'totalMinutes'>;
      const options = new Map<string, { option: Base; rides: number[]; heads: string[] }>();
      /** Courses de chaque ligne à chaque arrêt de départ : pour savoir si toutes desservent l'arrivée. */
      const departing = new Map<string, number>();
      for (const start of starts) {
        for (const trip of tripsAt.get(start.id) ?? []) {
          departing.set(`${trip.line}|${start.id}`, (departing.get(`${trip.line}|${start.id}`) ?? 0) + 1);
          const i = trip.stops.indexOf(start.id);
          for (let j = i + 1; j < trip.stops.length; j++) {
            const end = ends.get(trip.stops[j]);
            if (!end) continue;
            const key = `${trip.line}|${start.id}|${end.id}`;
            let entry = options.get(key);
            if (!entry) {
              entry = {
                option: { line: trip.line, origin: start.id, originName: start.name, destination: end.id, destinationName: end.name, walkFrom: start.walkMinutes, walkTo: end.walkMinutes },
                rides: [],
                heads: [],
              };
              options.set(key, entry);
            }
            entry.rides.push((trip.times[j] - trip.times[i]) / 60);
            entry.heads.push(trip.headsign);
          }
        }
      }
      const best = new Map<string, RouteOption>();
      for (const { option, rides, heads } of options.values()) {
        const rideMinutes = Math.round(median(rides));
        const candidate: RouteOption = {
          ...option,
          rideMinutes,
          towards: mostCommon(heads),
          headsigns: [...new Set(heads)].filter(Boolean),
          oneWay: heads.length >= (departing.get(`${option.line}|${option.origin}`) ?? 0),
          totalMinutes: option.walkFrom + rideMinutes + option.walkTo,
        };
        const current = best.get(option.line);
        if (!current || candidate.totalMinutes < current.totalMinutes) best.set(option.line, candidate);
      }
      return [...best.values()].sort((a, b) => a.totalMinutes - b.totalMinutes).slice(0, limit);
    },
    trips(route, day) {
      const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const at = (s: number) => new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), 0, 0, s);
      const line = lineLabel(route.line);
      const result: Trip[] = [];
      for (const trip of tripsAt.get(route.origin) ?? []) {
        if (trip.line !== line || !runsOn(trip.service, midnight)) continue;
        const i = trip.stops.indexOf(route.origin);
        const j = trip.stops.indexOf(route.destination, i + 1);
        if (j < 0) continue;
        result.push({ departs: at(trip.times[i]), arrives: at(trip.times[j]) });
      }
      return result.sort((a, b) => a.departs.getTime() - b.departs.getTime());
    },
  };
}

// --- Téléchargement et cache ---------------------------------------------------------------------------------------

export type GtfsSource = {
  /** Index des horaires ; null tant qu'aucune archive n'a pu être lue (premier téléchargement en échec). */
  index(): Promise<GtfsIndex | null>;
};

export type GtfsSourceDeps = {
  /** Archive gardée entre deux démarrages. */
  path: string;
  clock: Clock;
  logger: Logger;
  status?: SourceStatus;
  fetchFn?: typeof fetch;
  url?: string;
};

export function createGtfsSource({ path, clock, logger, status, fetchFn = (...a) => fetch(...a), url = GTFS_URL }: GtfsSourceDeps): GtfsSource {
  let index: GtfsIndex | null = null;
  let builtFrom = 0;
  let nextAttempt = 0;
  let pending: Promise<void> | null = null;

  async function download(): Promise<void> {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const next = buildGtfsIndex(unzip(buf)); // vérifie l'archive avant de remplacer la précédente
    await writeFile(`${path}.tmp`, buf);
    await rename(`${path}.tmp`, path);
    index = next;
    builtFrom = clock().getTime();
    logger.log('Horaires Irigo (GTFS) mis à jour');
  }

  async function refresh(): Promise<void> {
    const now = clock().getTime();
    if (!index) {
      try {
        const file = await stat(path);
        index = buildGtfsIndex(unzip(await readFile(path)));
        builtFrom = file.mtimeMs;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.error(`Horaires Irigo en cache illisibles : ${(err as Error).message}`);
      }
    }
    if (index && now - builtFrom < REFRESH_MS) return;
    if (now < nextAttempt) return;
    try {
      await download();
      status?.record('Irigo (horaires)');
    } catch (err) {
      nextAttempt = now + RETRY_MS;
      logger.error(`Horaires Irigo (GTFS) indisponibles : ${(err as Error).message}`);
      status?.record('Irigo (horaires)', err);
    }
  }

  return {
    async index() {
      const stale = !index || clock().getTime() - builtFrom >= REFRESH_MS;
      if (stale && !pending) pending = refresh().finally(() => (pending = null));
      // Archive déjà lue : on la sert pendant que la nouvelle se télécharge.
      if (!index && pending) await pending;
      return index;
    },
  };
}
