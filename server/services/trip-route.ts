// Carte en route (chantier « Prochain trajet », version 3), sans HTTP : l'itinéraire de MOTIS retenu, mis en forme
// pour la carte du téléphone (tracé de chaque étape décodé, arrêts nommés et placés), et pour chaque bus ou tram la
// course entière (GET /api/v5/trip de MOTIS : tous ses arrêts horodatés et son tracé), d'où le téléphone estime la
// position du véhicule à prendre. Aussi les nouvelles heures des courses suivies, une fois monté dedans. Aucune
// position de la personne ici : seulement des arrêts, des horaires et des tracés de lignes.
import { decodePolyline } from '../../shared/geo-path.ts';
import { distanceMeters, type RideRef, type RideUpdate, type RouteCourse, type RouteLeg, type RoutePlace, type RouteStop, type TripLegMode } from '../../shared/trip.ts';
import { isTransitLeg, type MotisItinerary, type MotisLeg, type MotisPlace, type MotisSource } from '../sources/motis.ts';

/** Courses dont on redemande les heures, au plus, en une fois. */
export const MAX_RIDES = 4;

const MODES: Record<string, TripLegMode> = { WALK: 'walk', BUS: 'bus', COACH: 'bus', TRAM: 'tram', SUBWAY: 'tram', CABLE_CAR: 'tram' };
export const modeOf = (mode: string): TripLegMode => MODES[mode] ?? 'rail';
const minutesBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000);

const placeOf = (p: MotisPlace): RoutePlace => ({ name: p.name, lat: p.lat, lon: p.lon, ...(p.stopId && { stopId: p.stopId }) });

/** Tracé d'une étape en [lon, lat] (vide sans tracé lisible). */
const pathOf = (leg: MotisLeg): [number, number][] => (leg.geometry ? decodePolyline(leg.geometry.points, leg.geometry.precision) : []);

/** Indice de l'arrêt `p` parmi `stops` à partir de `from` : même identifiant, sinon même nom, sinon le plus proche. */
function findStop(stops: RouteStop[], p: RoutePlace, from = 0): number {
  const rest = stops.map((s, i) => ({ s, i })).slice(from);
  const byId = p.stopId ? rest.find(({ s }) => s.stopId === p.stopId) : undefined;
  if (byId) return byId.i;
  const byName = rest.find(({ s }) => s.name === p.name);
  if (byName) return byName.i;
  let best = -1;
  let bestMeters = Number.POSITIVE_INFINITY;
  for (const { s, i } of rest) {
    const meters = distanceMeters(s, p);
    if (meters < bestMeters) [best, bestMeters] = [i, meters];
  }
  return best;
}

/**
 * Course entière d'après la réponse de /api/v5/trip, avec les arrêts de montée et de descente de l'étape ; null si la
 * course n'a pas d'arrêts ou si la montée n'est pas avant la descente.
 */
export function courseOf(trip: MotisItinerary, from: RoutePlace, to: RoutePlace): RouteCourse | null {
  const stops: RouteStop[] = [];
  const path: [number, number][] = [];
  for (const leg of trip.legs.filter(isTransitLeg)) {
    for (const s of leg.stops ?? []) {
      const last = stops.at(-1);
      // Courses enchaînées (interlining) : l'arrêt de jonction n'apparaît qu'une fois.
      if (last && last.stopId !== undefined && last.stopId === s.stopId) Object.assign(last, { departs: s.departs, scheduledDeparts: s.scheduledDeparts });
      else stops.push({ ...placeOf(s), ...(s.arrives && { arrives: s.arrives }), ...(s.departs && { departs: s.departs }), ...(s.scheduledArrives && { scheduledArrives: s.scheduledArrives }), ...(s.scheduledDeparts && { scheduledDeparts: s.scheduledDeparts }) });
    }
    path.push(...pathOf(leg));
  }
  if (stops.length < 2) return null;
  const board = findStop(stops, from);
  const alight = board < 0 ? -1 : findStop(stops, to, board + 1);
  if (board < 0 || alight <= board) return null;
  return { path, stops, board, alight };
}

/** Retard annoncé en minutes (temps réel seulement). */
const delayOf = (realtime: boolean, scheduled: string | undefined, expected: string | undefined) =>
  realtime && scheduled && expected ? minutesBetween(scheduled, expected) : undefined;

/** Course entière d'une étape de bus ou de tram ; null si MOTIS ne la donne pas (pas d'estimation du véhicule). */
async function fetchCourse(motis: MotisSource, tripId: string, from: RoutePlace, to: RoutePlace): Promise<{ trip: MotisItinerary; course: RouteCourse } | null> {
  try {
    const trip = await motis.trip(tripId);
    const course = courseOf(trip, from, to);
    return course ? { trip, course } : null;
  } catch {
    return null; // déjà journalisé par la source
  }
}

/** Étapes de l'itinéraire retenu pour la carte : marches de moins d'une minute retirées, courses entières jointes. */
export async function routeLegsOf(it: MotisItinerary, motis: MotisSource): Promise<RouteLeg[]> {
  const kept = it.legs.filter((leg) => leg.mode !== 'WALK' || minutesBetween(leg.departs, leg.arrives) >= 1);
  return Promise.all(
    kept.map(async (leg): Promise<RouteLeg> => {
      const base: RouteLeg = {
        mode: modeOf(leg.mode),
        from: placeOf(leg.from),
        to: placeOf(leg.to),
        departs: leg.departs,
        arrives: leg.arrives,
        scheduledDeparts: leg.scheduledDeparts,
        scheduledArrives: leg.scheduledArrives,
        path: pathOf(leg),
      };
      if (leg.mode === 'WALK') return base;
      const delay = delayOf(leg.realtime, leg.scheduledDeparts, leg.departs);
      const found = leg.tripId ? await fetchCourse(motis, leg.tripId, base.from, base.to) : null;
      return {
        ...base,
        ...(leg.line && { line: leg.line }),
        ...(leg.headsign && { headsign: leg.headsign }),
        ...(leg.tripId && { tripId: leg.tripId }),
        ...(delay !== undefined && { delayMinutes: delay }),
        ...(leg.cancelled && { cancelled: true }),
        ...(found && { course: found.course }),
      };
    }),
  );
}

/** Nouvelles heures des courses suivies (montée et descente), temps réel compris ; null pour une course introuvable. */
export async function rideUpdates(refs: RideRef[], motis: MotisSource): Promise<(RideUpdate | null)[]> {
  return Promise.all(
    refs.slice(0, MAX_RIDES).map(async (ref): Promise<RideUpdate | null> => {
      const found = await fetchCourse(motis, ref.tripId, ref.from, ref.to);
      if (!found) return null;
      const { trip, course } = found;
      const board = course.stops[course.board];
      const alight = course.stops[course.alight];
      const departs = board.departs ?? board.arrives;
      const arrives = alight.arrives ?? alight.departs;
      if (!departs || !arrives) return null;
      const realtime = trip.legs.some((l) => isTransitLeg(l) && l.realtime);
      const scheduledDeparts = board.scheduledDeparts ?? board.scheduledArrives ?? departs;
      const scheduledArrives = alight.scheduledArrives ?? alight.scheduledDeparts ?? arrives;
      const delay = delayOf(realtime, scheduledDeparts, departs);
      const cancelled = trip.legs.some((l) => l.cancelled);
      return { tripId: ref.tripId, departs, arrives, scheduledDeparts, scheduledArrives, ...(delay !== undefined && { delayMinutes: delay }), ...(cancelled && { cancelled: true }), course };
    }),
  );
}
