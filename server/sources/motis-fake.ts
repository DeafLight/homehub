// Faux MOTIS du monde fictif (tests et captures de la doc), comme les faux ÉcoleDirecte et Pronote : répond à
// GET /api/v5/plan dans la forme de MOTIS 2 avec un itinéraire inventé, bus 3 puis tram A, entre des arrêts
// d'exemple (arrêts intermédiaires et tracés compris), à `directModes=CAR` un trajet en voiture sans trafic, et à
// GET /api/v5/trip la course entière d'un de ces bus ou trams (carte en route), et le faux flux GTFS-RT des positions
// des véhicules, où avancent les trams A des itinéraires donnés (version 4). Aucun vrai arrêt, aucune vraie rue :
// les arrêts sont placés dans un quartier imaginaire, les tracés relient les arrêts en lignes brisées, et départ et
// arrivée sont ceux de la requête.
import { encodePolyline, type LonLat, pointAt, projectStops } from '../../shared/geo-path.ts';
import { distanceMeters } from '../../shared/trip.ts';
import { encodeVehiclePositions } from './gtfs-rt-encode.ts';
import type { GtfsRtVehicle } from './gtfs-rt.ts';

/** Flux du faux MOTIS : préfixe des identifiants d'arrêt, comme celui du NAS. */
export const FAKE_MOTIS_FEED = 'irigo';
export const FAKE_MOTIS_STOPS = {
  depart: { id: `${FAKE_MOTIS_FEED}_RALL`, name: 'Ralliement' },
  change: { id: `${FAKE_MOTIS_FEED}_TILL`, name: 'Mail des Tilleuls' },
  arrivee: { id: `${FAKE_MOTIS_FEED}_COLL`, name: 'Les Collèges' },
} as const;

export type FakeMotisOptions = {
  /** Départ du bus de l'itinéraire le plus tardif ; sinon calé pour arriver 2 min avant l'heure demandée. */
  busDeparts?: Date;
  /** Course de bus supprimée dans l'itinéraire le plus tardif (temps réel). */
  cancelled?: boolean;
  /** Retard du bus annoncé par le temps réel, en minutes. */
  delayMinutes?: number;
};

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
type Point = { name: string; stopId?: string; lat: number; lon: number };

/** Arrêt d'une fausse course : nom, identifiant, position, et minutes depuis l'arrêt de référence de l'itinéraire. */
type CourseStop = { name: string; id: string; lat: number; lon: number; at: number };
const S = (name: string, id: string, lat: number, lon: number, at: number): CourseStop => ({ name, id: `${FAKE_MOTIS_FEED}_${id}`, lat, lon, at });

/** Bus 3 : minutes depuis Ralliement (montée). */
const BUS_3: CourseStop[] = [
  S('Gare des Exemples', 'GEXE', 47.4605, -0.566, -6),
  S('Square Fictif', 'SQFI', 47.4635, -0.5615, -3),
  S(FAKE_MOTIS_STOPS.depart.name, 'RALL', 47.4668, -0.557, 0),
  S('Place des Essais', 'PESS', 47.469, -0.553, 3),
  S('Rue Imaginaire', 'RIMA', 47.4712, -0.55, 6),
  S('Pont du Modèle', 'PMOD', 47.4728, -0.5485, 9),
  S(FAKE_MOTIS_STOPS.change.name, 'TILL', 47.474, -0.547, 12),
  S('Lycée', 'LYCE', 47.4775, -0.542, 16),
];
const BUS_BOARD = 2;
const BUS_ALIGHT = 6;

/** Tram A : minutes depuis Mail des Tilleuls (montée). */
const TRAM_A: CourseStop[] = [
  S('Terminus du Sud', 'TSUD', 47.463, -0.538, -10),
  S('Les Prés Fictifs', 'PFIC', 47.4675, -0.541, -6),
  S('Quai des Tests', 'QTES', 47.471, -0.544, -3),
  S(FAKE_MOTIS_STOPS.change.name, 'TILL-A', 47.4742, -0.5466, 0),
  S('Jardin d’Exemple', 'JEXE', 47.4765, -0.5487, 4),
  S(FAKE_MOTIS_STOPS.arrivee.name, 'COLL', 47.4785, -0.5505, 8),
  S('Verneau', 'VERN', 47.483, -0.554, 12),
];
const TRAM_BOARD = 3;
const TRAM_ALIGHT = 5;

/** Ligne brisée entre deux points : un coude au milieu, comme une rue qui tourne. */
function bend(a: { lat: number; lon: number }, b: { lat: number; lon: number }, side = 1): LonLat[] {
  const mid: LonLat = [(a.lon + b.lon) / 2 + side * (b.lat - a.lat) * 0.15, (a.lat + b.lat) / 2 - side * (b.lon - a.lon) * 0.15];
  return [[a.lon, a.lat], mid];
}

/** Tracé d'une course entre les arrêts `from` et `to` (indices) : lignes brisées d'un arrêt au suivant. */
function coursePath(stops: CourseStop[], from: number, to: number): LonLat[] {
  const points: LonLat[] = [];
  for (let i = from; i < to; i++) points.push(...bend(stops[i], stops[i + 1], i % 2 ? 1 : -1));
  points.push([stops[to].lon, stops[to].lat]);
  return points;
}

/** Tracé d'une marche : un coude à angle droit (d'abord la latitude, puis la longitude). */
const walkPath = (a: Point, b: Point): LonLat[] => [[a.lon, a.lat], [a.lon, b.lat], [b.lon, b.lat]];

const geometry = (points: LonLat[]) => ({ points: encodePolyline(points), precision: 6, length: points.length });

/** Arrêt horodaté d'une course, `ref` étant l'heure de l'arrêt de référence (montée de l'itinéraire). */
function stopPlace(s: CourseStop, ref: number, delay: number) {
  const at = ref + s.at * MIN;
  return { name: s.name, stopId: s.id, lat: s.lat, lon: s.lon, arrival: iso(at + delay), departure: iso(at + delay), scheduledArrival: iso(at), scheduledDeparture: iso(at) };
}

/** Étape d'une course entre deux de ses arrêts (indices), arrêts intermédiaires et tracé compris. */
function rideLeg(mode: string, line: string, headsign: string, tripId: string, stops: CourseStop[], from: number, to: number, ref: number, delay: number, cancelled = false) {
  const start = ref + stops[from].at * MIN;
  const end = ref + stops[to].at * MIN;
  return {
    mode,
    from: stopPlace(stops[from], ref, delay),
    to: stopPlace(stops[to], ref, delay),
    intermediateStops: stops.slice(from + 1, to).map((s) => stopPlace(s, ref, delay)),
    duration: (end - start) / 1000,
    startTime: iso(start + delay),
    endTime: iso(end + delay),
    scheduledStartTime: iso(start),
    scheduledEndTime: iso(end),
    realTime: delay !== 0,
    routeShortName: line,
    displayName: line,
    headsign,
    tripId,
    cancelled,
    legGeometry: geometry(coursePath(stops, from, to)),
  };
}

function walkLeg(from: Point, to: Point, start: number, end: number) {
  return {
    mode: 'WALK',
    from: { ...from, departure: iso(start), scheduledDeparture: iso(start) },
    to: { ...to, arrival: iso(end), scheduledArrival: iso(end) },
    duration: (end - start) / 1000,
    startTime: iso(start),
    endTime: iso(end),
    scheduledStartTime: iso(start),
    scheduledEndTime: iso(end),
    realTime: false,
    legGeometry: geometry(walkPath(from, to)),
  };
}

/** Identifiants des fausses courses : la ligne, l'heure de montée prévue (ms) et le retard (min) y sont écrits. */
const busTripId = (bus: number, delayMin: number) => `fake_3_${bus}_${delayMin}`;
const tramTripId = (tram: number) => {
  const id = `fake_A_${tram}_0`;
  // Retenu pour le faux flux des positions (les 20 derniers suffisent).
  servedTrams.set(id, tram);
  if (servedTrams.size > 20) servedTrams.delete(servedTrams.keys().next().value!);
  return id;
};
/** Trams A des itinéraires donnés : identifiant et heure de montée à Mail des Tilleuls (ms). */
const servedTrams = new Map<string, number>();

const place = (s: CourseStop, stopId = s.id): Point => ({ name: s.name, stopId, lat: s.lat, lon: s.lon });

/**
 * Itinéraire marche 4 min, bus 3 (12 min), marche 4 min, tram A (8 min), marche 3 min, partant du bus de `bus` ; heures
 * en millisecondes.
 */
function itinerary(from: Point, to: Point, bus: number, options: { cancelled?: boolean; delay?: number } = {}) {
  const delayMin = options.delay ?? 0;
  const delay = delayMin * MIN;
  const tram = bus + 12 * MIN + 4 * MIN + 2 * MIN; // 2 min d'attente au changement
  const change = place(BUS_3[BUS_ALIGHT]);
  const legs = [
    walkLeg(from, place(BUS_3[BUS_BOARD]), bus - 4 * MIN, bus),
    rideLeg('BUS', '3', 'Lycée', busTripId(bus, delayMin), BUS_3, BUS_BOARD, BUS_ALIGHT, bus, delay, Boolean(options.cancelled)),
    walkLeg({ ...change, stopId: undefined }, place(TRAM_A[TRAM_BOARD]), bus + 12 * MIN + delay, bus + 16 * MIN + delay),
    rideLeg('TRAM', 'A', 'Verneau', tramTripId(tram), TRAM_A, TRAM_BOARD, TRAM_ALIGHT, tram, 0),
    walkLeg(place(TRAM_A[TRAM_ALIGHT]), to, tram + 8 * MIN, tram + 11 * MIN),
  ];
  return { duration: (tram + 11 * MIN - (bus - 4 * MIN)) / 1000, startTime: iso(bus - 4 * MIN), endTime: iso(tram + 11 * MIN), transfers: 1, legs };
}

/** Course entière d'un faux bus 3 ou tram A (GET /api/v5/trip), d'après son identifiant ; null s'il est inconnu. */
function fakeTrip(tripId: string) {
  const match = /^fake_(3|A)_(\d+)_(-?\d+)$/u.exec(tripId);
  if (!match) return null;
  const [, line, refText, delayText] = match;
  const ref = Number(refText);
  const delay = Number(delayText) * MIN;
  const stops = line === '3' ? BUS_3 : TRAM_A;
  const leg = rideLeg(line === '3' ? 'BUS' : 'TRAM', line, line === '3' ? 'Lycée' : 'Verneau', tripId, stops, 0, stops.length - 1, ref, delay);
  return { duration: leg.duration, startTime: leg.startTime, endTime: leg.endTime, transfers: 0, legs: [leg] };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** Réponse du faux MOTIS à une URL de /api/v5/plan (deux itinéraires, le plus tôt d'abord, 15 min d'écart) ou /api/v5/trip. */
export function fakeMotisPlan(url: URL, options: FakeMotisOptions = {}): Response {
  if (url.pathname === '/api/v5/trip') {
    const trip = fakeTrip(url.searchParams.get('tripId') ?? '');
    return trip ? json(trip) : new Response('course inconnue', { status: 404 });
  }
  if (url.pathname !== '/api/v5/plan') return new Response('introuvable', { status: 404 });
  const point = (name: string, value: string | null): Point | null => {
    const [lat, lon] = (value ?? '').split(',').map(Number);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { name, lat, lon } : null;
  };
  const from = point('START', url.searchParams.get('fromPlace'));
  const to = point('END', url.searchParams.get('toPlace'));
  const time = Date.parse(url.searchParams.get('time') ?? '');
  if (!from || !to || Number.isNaN(time)) return new Response('requête invalide', { status: 400 });
  // Voiture (ligne voiture sans TomTom) : à 25 km/h à vol d'oiseau plus un tiers, sans trafic.
  if (url.searchParams.get('directModes') === 'CAR') {
    const meters = Math.round(distanceMeters(from, to) * 1.35);
    const duration = Math.round(meters / (25_000 / 3600));
    const car = { duration, startTime: iso(time), endTime: iso(time + duration * 1000), transfers: 0, legs: [{ mode: 'CAR', distance: meters, duration }] };
    return json({ requestParameters: {}, debugOutput: {}, from, to, direct: [car], itineraries: [] });
  }
  // Partir à l'heure demandée (arriveBy=false) : 4 min de marche puis 10 min d'attente du bus, puis un toutes les 15 min.
  if (url.searchParams.get('arriveBy') === 'false') {
    const bus = time + 14 * MIN;
    return json({ requestParameters: {}, debugOutput: {}, from, to, direct: [], itineraries: [itinerary(from, to, bus), itinerary(from, to, bus + 15 * MIN)] });
  }
  // Itinéraire de 29 min du bus à l'arrivée : bus au plus tard 31 min avant l'heure demandée (arrivée 2 min avant).
  const latest = time - 31 * MIN;
  const bus = options.busDeparts && options.busDeparts.getTime() <= latest ? options.busDeparts.getTime() : latest;
  return json({
    requestParameters: {},
    debugOutput: {},
    from,
    to,
    direct: [],
    itineraries: [itinerary(from, to, bus - 15 * MIN), itinerary(from, to, bus, { cancelled: options.cancelled, delay: options.delayMinutes })],
  });
}

/**
 * Position d'un faux tram A à l'instant `t` (ms), `ref` étant son heure à Mail des Tilleuls : sur son tracé, entre deux
 * arrêts ou à l'un d'eux, avec l'arrêt suivant (identifiant GTFS, sans le préfixe de flux) et le cap.
 */
function tramAt(tripId: string, ref: number, t: number): GtfsRtVehicle | null {
  const minutes = (t - ref) / MIN;
  const last = TRAM_A.length - 1;
  if (minutes < TRAM_A[0].at || minutes > TRAM_A[last].at) return null;
  const path = coursePath(TRAM_A, 0, last);
  const along = projectStops(path, TRAM_A);
  const k = TRAM_A.findIndex((s) => s.at >= minutes);
  const stopped = TRAM_A[k].at === minutes;
  const from = Math.max(0, k - 1);
  const ratio = stopped || k === 0 ? 1 : (minutes - TRAM_A[from].at) / (TRAM_A[k].at - TRAM_A[from].at);
  const here = stopped ? along[k] : along[from] + ratio * (along[k] - along[from]);
  const point = pointAt(path, here);
  const ahead = pointAt(path, here + 15);
  if (!point || !ahead) return null;
  const bearing = (Math.atan2((ahead[0] - point[0]) * Math.cos((point[1] * Math.PI) / 180), ahead[1] - point[1]) * 180) / Math.PI;
  const gtfsId = TRAM_A[k].id.slice(TRAM_A[k].id.indexOf('_') + 1);
  return { tripId, lat: point[1], lon: point[0], bearing: (bearing + 360) % 360, timestamp: Math.round(t / 1000), stopId: gtfsId, status: stopped ? 'stopped' : 'in-transit' };
}

/**
 * Faux flux GTFS-RT VehiclePositions : chaque tram A des itinéraires donnés, en approche de son arrêt de montée (à
 * 5 min de celui-ci, deux arrêts avant) tant que l'heure n'y est pas, puis à l'heure le long de sa course ; position
 * vieille de 8 s. Plus un bus d'une autre course, que le serveur ne doit jamais renvoyer au téléphone.
 */
export function fakeVehiclePositions(now: number): Uint8Array<ArrayBuffer> {
  const vehicles: GtfsRtVehicle[] = [];
  for (const [tripId, ref] of servedTrams) {
    const v = tramAt(tripId, ref, Math.max(now, ref - 5 * MIN));
    if (v) vehicles.push({ ...v, timestamp: Math.round(now / 1000) - 8 });
  }
  vehicles.push({ tripId: 'fake_9_autre_course', lat: 47.465, lon: -0.56, bearing: 90, timestamp: Math.round(now / 1000) - 8 });
  return encodeVehiclePositions(vehicles, Math.round(now / 1000));
}
