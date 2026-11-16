// Faux MOTIS du monde fictif (tests et captures de la doc), comme les faux ÉcoleDirecte et Pronote : répond à
// GET /api/v5/plan dans la forme de MOTIS 2 avec un itinéraire inventé, bus 3 puis tram A, entre des arrêts
// d'exemple, et à `directModes=CAR` un trajet en voiture sans trafic. Aucun vrai arrêt, aucune vraie adresse : départ
// et arrivée sont ceux de la requête.
import { distanceMeters } from '../../shared/trip.ts';

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

function leg(mode: string, from: Point, to: Point, start: number, end: number, extra: Record<string, unknown> = {}, delay = 0) {
  return {
    mode,
    from: { ...from, departure: iso(start + delay), scheduledDeparture: iso(start) },
    to: { ...to, arrival: iso(end + delay), scheduledArrival: iso(end) },
    duration: (end - start) / 1000,
    startTime: iso(start + delay),
    endTime: iso(end + delay),
    scheduledStartTime: iso(start),
    scheduledEndTime: iso(end),
    realTime: delay !== 0,
    legGeometry: { points: '_ibE_seK_seK_seK', precision: 6, length: 2 },
    ...extra,
  };
}

/**
 * Itinéraire marche 4 min, bus 3 (12 min), marche 4 min, tram A (8 min), marche 3 min, partant du bus de `bus` ; heures
 * en millisecondes.
 */
function itinerary(from: Point, to: Point, bus: number, options: { cancelled?: boolean; delay?: number } = {}) {
  const delay = (options.delay ?? 0) * MIN;
  const { depart, change, arrivee } = FAKE_MOTIS_STOPS;
  const stop = (s: { id: string; name: string }, lat: number): Point => ({ name: s.name, stopId: s.id, lat, lon: -0.55 });
  const [a, b, c] = [stop(depart, 47.471), stop(change, 47.475), stop(arrivee, 47.479)];
  const tram = bus + 12 * MIN + 4 * MIN + 2 * MIN; // 2 min d'attente au changement
  const legs = [
    leg('WALK', from, a, bus - 4 * MIN, bus),
    leg('BUS', a, b, bus, bus + 12 * MIN, { routeShortName: '3', displayName: '3', headsign: 'Lycée', tripId: '20261105_fake_3', cancelled: Boolean(options.cancelled) }, delay),
    leg('WALK', b, { ...b, stopId: undefined }, bus + 12 * MIN + delay, bus + 16 * MIN + delay),
    leg('TRAM', { ...b, stopId: `${FAKE_MOTIS_FEED}_TILL-A` }, c, tram, tram + 8 * MIN, { routeShortName: 'A', displayName: 'A', headsign: 'Verneau', tripId: '20261105_fake_A' }),
    leg('WALK', c, to, tram + 8 * MIN, tram + 11 * MIN),
  ];
  return { duration: (tram + 11 * MIN - (bus - 4 * MIN)) / 1000, startTime: iso(bus - 4 * MIN), endTime: iso(tram + 11 * MIN), transfers: 1, legs };
}

/** Réponse du faux MOTIS à une URL de /api/v5/plan : deux itinéraires, le plus tôt d'abord (15 min d'écart). */
export function fakeMotisPlan(url: URL, options: FakeMotisOptions = {}): Response {
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
    return new Response(JSON.stringify({ requestParameters: {}, debugOutput: {}, from, to, direct: [car], itineraries: [] }), { headers: { 'content-type': 'application/json' } });
  }
  // Partir à l'heure demandée (arriveBy=false) : 4 min de marche puis 10 min d'attente du bus, puis un toutes les 15 min.
  if (url.searchParams.get('arriveBy') === 'false') {
    const bus = time + 14 * MIN;
    const body = { requestParameters: {}, debugOutput: {}, from, to, direct: [], itineraries: [itinerary(from, to, bus), itinerary(from, to, bus + 15 * MIN)] };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }
  // Itinéraire de 29 min du bus à l'arrivée : bus au plus tard 31 min avant l'heure demandée (arrivée 2 min avant).
  const latest = time - 31 * MIN;
  const bus = options.busDeparts && options.busDeparts.getTime() <= latest ? options.busDeparts.getTime() : latest;
  const body = {
    requestParameters: {},
    debugOutput: {},
    from,
    to,
    direct: [],
    itineraries: [itinerary(from, to, bus - 15 * MIN), itinerary(from, to, bus, { cancelled: options.cancelled, delay: options.delayMinutes })],
  };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
