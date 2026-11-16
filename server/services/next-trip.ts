// « Prochain trajet » du téléphone (chantier « Prochain trajet », version 2), sans HTTP : le prochain rendez-vous situé
// de la personne (un cours au lieu « école » de son trajet, ou un rendez-vous d'agenda dont le lieu est un lieu de la
// famille ou une adresse sûre de la Géoplateforme), dans les 3 h, et l'itinéraire de MOTIS pour y arriver avec une
// marge, depuis la position du téléphone (ou depuis la maison, faute de position : notification). Pour un parent, la
// ligne voiture : TomTom avec le trafic (origine arrondie à environ 100 m), sinon MOTIS sans trafic. La position n'est
// ni gardée ni journalisée : elle ne sert qu'au calcul et ne part qu'à MOTIS (sur le NAS).
import type { CalendarEvent, CommuteSettings, SchoolCourse, TransitPlace } from '../../shared/types.ts';
import {
  type CarTrip,
  distanceMeters,
  googleMapsUrl,
  type LatLon,
  type NextTrip,
  type TripDestination,
  type TripLeg,
  type TripLegMode,
  type TripOption,
  roughly,
} from '../../shared/trip.ts';
import type { Logger } from '../config-store.ts';
import { isTransitLeg, type MotisItinerary, type MotisSource } from '../sources/motis.ts';
import type { TomTomSource } from '../sources/tomtom.ts';
import { DEFAULT_ARRIVE_BEFORE } from '../sources/transit-settings.ts';
import type { Clock, TimeRange } from '../sources/types.ts';

/** Rendez-vous pris en compte : ceux qui commencent dans les 3 h. */
export const TRIP_WINDOW_MS = 3 * 3_600_000;
/** Déjà sur place : à moins de 300 m du lieu, pas de trajet. */
export const HERE_METERS = 300;
/** Marge avant un rendez-vous d'agenda (un cours prend celle de son trajet, 10 min par défaut, page Transports). */
export const EVENT_MARGIN_MIN = 5;
/** Lieu d'agenda géocodé : au plus à cette distance du centre réglé (météo). */
export const MAX_FROM_CENTER_METERS = 30_000;
/** Lieux d'agenda géocodés gardés en mémoire (même texte, même réponse). */
const LOCATE_CACHE_MS = 24 * 3_600_000;
const LOCATE_CACHE_MAX = 200;
/** Départ déjà passé de moins que ça : encore montré (« pars maintenant »). */
const LATE_MS = 60_000;

export type TripAppointments = { courses: SchoolCourse[]; events: CalendarEvent[] };

export type NextTripDeps = {
  /** Cours (sans ceux des jours sans école) et rendez-vous d'agenda de `ownerId` sur l'intervalle. */
  appointments(ownerId: string, range: TimeRange): Promise<TripAppointments>;
  /** Lieux de la famille et trajets (page Transports). */
  places(): TransitPlace[];
  commuteOf(ownerId: string): CommuteSettings | undefined;
  isParent(ownerId: string): boolean;
  /** Centre réglé (météo) : un lieu géocodé doit en être proche. */
  center(): LatLon | undefined;
  /** Géocodage sûr d'un lieu d'agenda (Géoplateforme), ou null. */
  locate?(query: string, near: LatLon): Promise<(LatLon & { label: string }) | null>;
  motis?: MotisSource;
  tomtom?: TomTomSource;
  clock: Clock;
  logger: Logger;
};

/** Rendez-vous retenu, avec sa marge en minutes. */
type Target = { destination: TripDestination; margin: number };

export type TripOptions = {
  /** Ligne voiture (parents) : la carte du téléphone, pas la notification. */
  car?: boolean;
  /** Cours : seulement le premier de la journée (calcul depuis la maison, pour la notification). */
  firstCourseOnly?: boolean;
};

export type NextTripService = {
  /** Vrai si MOTIS est configuré (sinon pas de carte). */
  enabled(): boolean;
  /** Le prochain rendez-vous situé dans les 3 h, s'il y en a un (sans calcul d'itinéraire). */
  destination(ownerId: string, options?: TripOptions): Promise<Target | null>;
  /** Le trajet vers le prochain rendez-vous situé, depuis `position` ou, à défaut, depuis la maison. */
  plan(ownerId: string, position: LatLon | null, options?: TripOptions): Promise<NextTrip | null>;
};

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();

/** Lieu de la famille reconnu par son nom (ou son adresse exacte) dans le champ LOCATION d'un rendez-vous. */
export function placeNamed(places: TransitPlace[], location: string): TransitPlace | undefined {
  const wanted = normalize(location);
  return wanted ? places.find((p) => normalize(p.label) === wanted || normalize(p.address) === wanted) : undefined;
}

/** Lieu « école » d'un membre : l'arrivée de son trajet, sinon le seul lieu marqué école. */
export function schoolPlaceOf(places: TransitPlace[], commute: CommuteSettings | undefined): TransitPlace | undefined {
  if (commute) return places.find((p) => p.id === commute.to);
  const schools = places.filter((p) => p.icon === 'school');
  return schools.length === 1 ? schools[0] : undefined;
}

/** La maison : le départ du trajet du membre, sinon le premier lieu marqué maison. */
export function homePlaceOf(places: TransitPlace[], commute: CommuteSettings | undefined): TransitPlace | undefined {
  return (commute && places.find((p) => p.id === commute.from)) ?? places.find((p) => p.icon === 'home');
}

const MODES: Record<string, TripLegMode> = { WALK: 'walk', BUS: 'bus', COACH: 'bus', TRAM: 'tram', SUBWAY: 'tram', CABLE_CAR: 'tram' };
const modeOf = (mode: string): TripLegMode => MODES[mode] ?? 'rail';
const minutesBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000);

/** Itinéraire de MOTIS tel que la carte le montre : étapes à pied de moins d'une minute retirées, retards en minutes. */
export function optionOf(it: MotisItinerary): TripOption {
  const legs = it.legs.flatMap((leg): TripLeg[] => {
    const minutes = minutesBetween(leg.departs, leg.arrives);
    if (leg.mode === 'WALK') return minutes < 1 ? [] : [{ mode: 'walk', departs: leg.departs, arrives: leg.arrives, minutes }];
    const delay = leg.realtime ? minutesBetween(leg.scheduledDeparts, leg.departs) : undefined;
    return [
      {
        mode: modeOf(leg.mode),
        ...(leg.line && { line: leg.line }),
        ...(leg.headsign && { headsign: leg.headsign }),
        from: leg.from.name,
        to: leg.to.name,
        departs: leg.departs,
        arrives: leg.arrives,
        minutes,
        ...(delay !== undefined && { delayMinutes: delay }),
        ...(leg.cancelled && { cancelled: true }),
      },
    ];
  });
  return { leaveAt: it.departs, arrives: it.arrives, legs, realtime: it.legs.some((l) => isTransitLeg(l) && l.realtime) };
}

const usable = (o: TripOption) => !o.legs.some((l) => l.cancelled);

export function createNextTripService(deps: NextTripDeps): NextTripService {
  const { motis, tomtom, clock, logger } = deps;
  const located = new Map<string, { at: number; result: Promise<(LatLon & { label: string }) | null> }>();

  /** Lieu d'un rendez-vous d'agenda : un lieu de la famille, sinon une adresse sûre et proche du centre ; ou null. */
  async function placeOfEvent(location: string): Promise<{ label: string; lat: number; lon: number } | null> {
    const known = placeNamed(deps.places(), location);
    if (known) return known;
    const center = deps.center();
    if (!center || !deps.locate) return null;
    const key = normalize(location);
    const now = clock().getTime();
    for (const [k, v] of located) if (now - v.at >= LOCATE_CACHE_MS) located.delete(k);
    let hit = located.get(key);
    if (!hit) {
      const result = deps.locate(location, center).catch((err: unknown) => {
        logger.error(`Lieu d'un rendez-vous introuvable : ${(err as Error).message}`);
        return null;
      });
      if (located.size >= LOCATE_CACHE_MAX) located.delete(located.keys().next().value!);
      hit = { at: now, result };
      located.set(key, hit);
    }
    const found = await hit.result;
    return found && distanceMeters(center, found) <= MAX_FROM_CENTER_METERS ? found : null;
  }

  async function destination(ownerId: string, options: TripOptions = {}): Promise<Target | null> {
    const now = clock();
    // Depuis minuit : le premier cours de la journée se reconnaît même s'il a commencé.
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const range = { from: midnight, to: new Date(now.getTime() + TRIP_WINDOW_MS) };
    const { courses, events } = await deps.appointments(ownerId, range);
    const inWindow = (start: string) => Date.parse(start) > now.getTime() && Date.parse(start) <= range.to.getTime();
    const places = deps.places();
    const commute = deps.commuteOf(ownerId);
    const school = schoolPlaceOf(places, commute);

    type Candidate = { start: string; resolve: () => Promise<Target | null> };
    const candidates: Candidate[] = [];
    if (school) {
      // Premier cours de la journée seulement quand on part de la maison (notification) : les suivants, on est déjà là.
      const today = courses.filter((c) => !c.cancelled && new Date(c.start).toDateString() === now.toDateString()).sort((a, b) => a.start.localeCompare(b.start));
      const pool = options.firstCourseOnly ? today.slice(0, 1) : courses.filter((c) => !c.cancelled);
      for (const c of pool.filter((c) => inWindow(c.start))) {
        candidates.push({
          start: c.start,
          resolve: async () => ({
            destination: { kind: 'course', title: c.subject, start: c.start, place: school.label, lat: school.lat, lon: school.lon },
            margin: commute?.arriveBefore ?? DEFAULT_ARRIVE_BEFORE,
          }),
        });
      }
    }
    for (const e of events) {
      const location = e.location?.trim();
      if (e.allDay || !location || !inWindow(e.start)) continue;
      candidates.push({
        start: e.start,
        resolve: async () => {
          const place = await placeOfEvent(location);
          return place && { destination: { kind: 'event', title: e.title, start: e.start, place: place.label, lat: place.lat, lon: place.lon }, margin: EVENT_MARGIN_MIN };
        },
      });
    }
    candidates.sort((a, b) => a.start.localeCompare(b.start));
    for (const candidate of candidates) {
      const target = await candidate.resolve();
      if (target) return target;
    }
    return null;
  }

  async function itineraries(from: LatLon, to: LatLon, time: Date, arriveBy: boolean): Promise<TripOption[]> {
    if (!motis) return [];
    try {
      return (await motis.plan({ from, to, time, arriveBy })).map(optionOf).filter(usable);
    } catch {
      return []; // déjà journalisé par la source, sans les positions
    }
  }

  /** Ligne voiture : TomTom avec le trafic (origine arrondie), sinon MOTIS sans trafic ; null si aucun ne répond. */
  async function carOf(origin: LatLon, to: LatLon, arriveBy: number): Promise<CarTrip | null> {
    const mapsUrl = googleMapsUrl(to);
    const trip = (seconds: number, meters: number | undefined, traffic: boolean): CarTrip => ({
      minutes: Math.max(1, Math.round(seconds / 60)),
      leaveAt: new Date(arriveBy - seconds * 1000).toISOString(),
      ...(meters !== undefined && { meters }),
      traffic,
      mapsUrl,
    });
    if (tomtom?.enabled()) {
      try {
        const route = await tomtom.route(roughly(origin), to);
        return trip(route.seconds, route.meters, true);
      } catch {
        // déjà journalisé ; MOTIS en secours
      }
    }
    if (motis?.enabled()) {
      try {
        const car = await motis.car(origin, to, clock());
        if (car) return trip(car.seconds, car.meters, false);
      } catch {
        // déjà journalisé
      }
    }
    return null;
  }

  return {
    enabled: () => Boolean(motis?.enabled()),
    destination,

    async plan(ownerId, position, options = {}) {
      if (!motis?.enabled()) return null;
      const target = await destination(ownerId, options);
      if (!target) return null;
      const commute = deps.commuteOf(ownerId);
      const home = homePlaceOf(deps.places(), commute);
      const origin = position ?? (home && { lat: home.lat, lon: home.lon });
      const { destination: dest, margin } = target;
      if (!origin || distanceMeters(origin, dest) <= HERE_METERS) return null;
      const now = clock().getTime();
      const arriveBy = Date.parse(dest.start) - margin * 60_000;
      // Arriver à temps : parmi les itinéraires qui arrivent avant l'heure visée et qu'on peut encore prendre, celui qui
      // fait partir le plus tard ; l'autre choix, le précédent.
      const onTime = (await itineraries(origin, dest, new Date(arriveBy), true))
        .filter((o) => Date.parse(o.arrives) <= arriveBy && Date.parse(o.leaveAt) >= now - LATE_MS)
        .sort((a, b) => Date.parse(b.leaveAt) - Date.parse(a.leaveAt));
      let [transit = null, other = null] = onTime;
      let late = false;
      if (!transit) {
        // Trop tard pour arriver à temps : le prochain départ, et le suivant.
        const next = (await itineraries(origin, dest, new Date(now), false))
          .filter((o) => Date.parse(o.leaveAt) >= now - LATE_MS)
          .sort((a, b) => Date.parse(a.leaveAt) - Date.parse(b.leaveAt));
        [transit = null, other = null] = next;
        late = transit !== null && Date.parse(transit.arrives) > arriveBy;
      } else if (!other) {
        // Le précédent est déjà parti : la course suivante, comme autre choix (même si elle arrive après l'heure visée).
        const after = Date.parse(transit.leaveAt);
        other = (await itineraries(origin, dest, new Date(after + 60_000), false)).filter((o) => Date.parse(o.leaveAt) > after).sort((a, b) => Date.parse(a.leaveAt) - Date.parse(b.leaveAt))[0] ?? null;
      }
      const withCar = options.car && deps.isParent(ownerId);
      return {
        destination: dest,
        arriveBy: new Date(arriveBy).toISOString(),
        from: position ? 'position' : 'home',
        transit,
        other,
        late,
        ...(withCar && { car: await carOf(origin, dest, arriveBy) }),
      };
    },
  };
}
