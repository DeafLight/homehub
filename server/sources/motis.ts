// Itinéraires en transports en commun par MOTIS (moteur de Transitous, API MOTIS 2, GET /api/v5/plan) : marche,
// correspondances et temps réel compris (MOTIS lit lui-même le flux GTFS-RT TripUpdates d'Irigo). Hébergé sur le NAS
// (les positions de la famille ne sortent pas de la maison) ; https://api.transitous.org ne sert qu'au développement.
// Sans adresse configurée (HOMEHUB_MOTIS_URL ou `transit.motis.url`), la source est désactivée et HomeHub garde son
// calcul maison à lignes directes (gtfs.ts). Réponses gardées une minute ; une panne est gardée autant, pour ne pas
// relancer MOTIS à chaque rafraîchissement de l'écran, et l'appelant se replie sur le calcul maison. Sert aussi au
// « Prochain trajet » du téléphone, et en voiture (`directModes=CAR`, sans trafic) au secours de TomTom.
import { z } from 'zod';
import type { Logger } from '../config-store.ts';
import type { LatLon } from './gtfs.ts';
import { lineLabel } from './lines.ts';
import type { SourceStatus } from './source-status.ts';
import type { Clock } from './types.ts';

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_MS = 60_000;
const MAX_CACHED = 32;
const ITINERARIES = 5;
/** Nom de la source sur la page « Le NAS ». */
export const MOTIS_STATUS = 'MOTIS (itinéraires)';

const isoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'heure illisible');

const placeSchema = z.object({
  name: z.string(),
  stopId: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
  arrival: isoTime.optional(),
  departure: isoTime.optional(),
  scheduledArrival: isoTime.optional(),
  scheduledDeparture: isoTime.optional(),
  cancelled: z.boolean().optional(),
});

const legSchema = z.object({
  mode: z.string(),
  from: placeSchema,
  to: placeSchema,
  startTime: isoTime,
  endTime: isoTime,
  scheduledStartTime: isoTime,
  scheduledEndTime: isoTime,
  realTime: z.boolean().default(false),
  distance: z.number().optional(),
  headsign: z.string().optional(),
  tripId: z.string().optional(),
  routeShortName: z.string().optional(),
  displayName: z.string().optional(),
  cancelled: z.boolean().optional(),
  legGeometry: z.object({ points: z.string(), precision: z.number().default(6) }).optional(),
});

const planSchema = z.object({
  itineraries: z.array(
    z.object({
      startTime: isoTime,
      endTime: isoTime,
      duration: z.number(),
      transfers: z.number().default(0),
      legs: z.array(legSchema).min(1),
    }),
  ),
});

export type MotisPlace = { name: string; stopId?: string; lat: number; lon: number };

/** Étape d'un itinéraire : marche, ou course d'un bus ou d'un tram. Heures ISO 8601. */
export type MotisLeg = {
  /** Mode MOTIS : WALK, BUS, TRAM, RAIL… */
  mode: string;
  /** Ligne affichée (« 3 », « A ») ; absente pour la marche. */
  line?: string;
  headsign?: string;
  tripId?: string;
  from: MotisPlace;
  to: MotisPlace;
  /** Heures prévues par le temps réel (égales aux théoriques sans temps réel) et heures théoriques. */
  departs: string;
  arrives: string;
  scheduledDeparts: string;
  scheduledArrives: string;
  realtime: boolean;
  cancelled: boolean;
  /** Tracé (polyline Google, précision `precision`). */
  geometry?: { points: string; precision: number };
};

export type MotisItinerary = { departs: string; arrives: string; transfers: number; legs: MotisLeg[] };

export const isTransitLeg = (leg: MotisLeg) => leg.mode !== 'WALK' && leg.line !== undefined;

/**
 * Identifiant GTFS d'un arrêt MOTIS : MOTIS préfixe celui du GTFS par le nom du flux et « _ » (« irigo_RALL »). Les
 * noms de flux de Transitous n'ont pas de « _ » ; ceux du NAS non plus (« irigo »).
 */
export const gtfsStopId = (stopId: string) => stopId.slice(stopId.indexOf('_') + 1);

const place = (p: z.infer<typeof placeSchema>): MotisPlace => ({ name: p.name, ...(p.stopId && { stopId: p.stopId }), lat: p.lat, lon: p.lon });
const iso = (s: string) => new Date(s).toISOString();

/** Itinéraires d'une réponse de /api/v5/plan (les étapes sans course, marche comprise, restent dans l'ordre). */
export function parsePlan(json: unknown): MotisItinerary[] {
  return planSchema.parse(json).itineraries.map((it) => ({
    departs: iso(it.startTime),
    arrives: iso(it.endTime),
    transfers: it.transfers,
    legs: it.legs.map((leg): MotisLeg => {
      const name = leg.mode === 'WALK' ? undefined : (leg.routeShortName || leg.displayName);
      return {
        mode: leg.mode,
        ...(name && { line: lineLabel(name) }),
        ...(leg.headsign && { headsign: leg.headsign }),
        ...(leg.tripId && { tripId: leg.tripId }),
        from: place(leg.from),
        to: place(leg.to),
        departs: iso(leg.startTime),
        arrives: iso(leg.endTime),
        scheduledDeparts: iso(leg.scheduledStartTime),
        scheduledArrives: iso(leg.scheduledEndTime),
        realtime: leg.realTime,
        cancelled: Boolean(leg.cancelled || leg.from.cancelled || leg.to.cancelled),
        ...(leg.legGeometry && { geometry: leg.legGeometry }),
      };
    }),
  }));
}

export type PlanRequest = { from: LatLon; to: LatLon; time: Date; arriveBy: boolean };

export type MotisSource = {
  /** Vrai si une adresse de MOTIS est configurée. */
  enabled(): boolean;
  /** Itinéraires (au plus 5) ; lève une erreur si MOTIS ne répond pas ou n'est pas configuré. */
  plan(request: PlanRequest): Promise<MotisItinerary[]>;
  /**
   * Trajet en voiture sans trafic (`directModes=CAR`), secours de la ligne voiture quand TomTom manque ; null si MOTIS
   * n'en trouve pas. Lève une erreur si MOTIS ne répond pas.
   */
  car(from: LatLon, to: LatLon, time: Date): Promise<MotisCar | null>;
};

/** Trajet direct en voiture (sans trafic) : durée en secondes, distance en mètres si MOTIS la donne. */
export type MotisCar = { seconds: number; meters?: number };

const directSchema = z.object({
  direct: z
    .array(z.object({ duration: z.number(), legs: z.array(z.object({ mode: z.string(), distance: z.number().optional() })).default([]) }))
    .default([]),
});

/** Premier trajet direct en voiture d'une réponse de /api/v5/plan (`directModes=CAR`), ou null. */
export function parseCar(json: unknown): MotisCar | null {
  const first = directSchema.parse(json).direct.find((d) => d.legs.some((l) => l.mode === 'CAR'));
  if (!first) return null;
  const meters = first.legs.reduce((sum, l) => sum + (l.distance ?? 0), 0);
  return { seconds: first.duration, ...(meters > 0 && { meters: Math.round(meters) }) };
}

export type MotisSourceDeps = {
  /** Adresse du service (« http://motis:8080 ») ; undefined : désactivé. Relue à chaque appel (config rechargée). */
  url: () => string | undefined;
  clock: Clock;
  logger: Logger;
  status?: SourceStatus;
  fetchFn?: typeof fetch;
};

/** Coordonnées arrondies au mètre près, comme MOTIS les attend (« lat,lon »). */
const latLon = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

export function createMotisSource({ url, clock, logger, status, fetchFn = (...a) => fetch(...a) }: MotisSourceDeps): MotisSource {
  const cache = new Map<string, { at: number; result: Promise<unknown> }>();

  async function request<T>(base: string, req: PlanRequest, parse: (json: unknown) => T, extra: Record<string, string> = {}): Promise<T> {
    const params = new URLSearchParams({
      fromPlace: latLon(req.from),
      toPlace: latLon(req.to),
      time: req.time.toISOString(),
      arriveBy: String(req.arriveBy),
      numItineraries: String(ITINERARIES),
      ...extra,
    });
    try {
      const res = await fetchFn(`${base.replace(/\/+$/u, '')}/api/v5/plan?${params}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = parse(await res.json());
      status?.record(MOTIS_STATUS);
      return result;
    } catch (err) {
      // Jamais la requête dans le message : elle contient des positions.
      const message = err instanceof z.ZodError ? 'réponse illisible' : (err as Error).message;
      logger.error(`MOTIS indisponible : ${message}`);
      status?.record(MOTIS_STATUS, new Error(message));
      throw new Error(message);
    }
  }

  /** Réponse gardée une minute (panne comprise), par sorte de requête, adresse et requête. */
  function cached<T>(kind: string, req: PlanRequest, run: (base: string) => Promise<T>): Promise<T> {
    const base = url();
    if (!base) return Promise.reject(new Error('MOTIS non configuré'));
    const now = clock().getTime();
    for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
    const key = `${kind}|${base}|${latLon(req.from)}|${latLon(req.to)}|${req.time.getTime()}|${req.arriveBy}`;
    const hit = cache.get(key);
    if (hit) return hit.result as Promise<T>;
    const result = run(base);
    result.catch(() => {}); // erreur gardée en cache, lue par chaque appelant
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now, result });
    return result;
  }

  return {
    enabled: () => Boolean(url()),
    plan: (req) => cached('plan', req, (base) => request(base, req, parsePlan)),
    car(from, to, time) {
      // Heure arrondie à la minute : la durée sans trafic ne change pas d'une seconde à l'autre (cache).
      const req = { from, to, time: new Date(Math.floor(time.getTime() / 60_000) * 60_000), arriveBy: false };
      return cached('car', req, (base) => request(base, req, parseCar, { directModes: 'CAR', numItineraries: '1' }));
    },
  };
}
