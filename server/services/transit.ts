// Bus et tram pour les écrans, sans HTTP : prochains passages aux arrêts de l'accueil, et trajet du matin d'un membre
// (carte « Pars dans N min »), sur sa plage horaire fixe ou calé sur son emploi du temps : l'itinéraire de MOTIS
// (correspondances comprises) ou, à défaut, la dernière course de la ligne réglée qui arrive avant le premier cours,
// d'après les horaires théoriques ; la première course est ensuite reconnue dans le temps réel (SIRI).
import { localTime } from '../../shared/dates.ts';
import type { Commute, SchoolCourse, TransitData } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import type { GtfsSource } from '../sources/gtfs.ts';
import { gtfsStopId, isTransitLeg, type MotisItinerary, type MotisSource } from '../sources/motis.ts';
import type { TransitSource } from '../sources/irigo.ts';
import { lineLabel } from '../sources/lines.ts';
import type { CommuteTrip, TransitSettingsStore } from '../sources/transit-settings.ts';
import type { Clock, TimeRange } from '../sources/types.ts';
import { accessory } from './accessory.ts';

/** Passages gardés par arrêt et pour un trajet. */
const STOP_DEPARTURES = 8;
const COMMUTE_DEPARTURES = 4;
/** Trajet selon l'emploi du temps : la carte reste un moment après l'heure de la course (« Trop tard », suivant). */
const PLAN_LINGER_MS = 5 * 60_000;
/** Écart toléré entre l'horaire théorique du GTFS et celui du temps réel pour reconnaître la même course. */
const SAME_TRIP_MS = 90_000;
/** Passages plus tôt que la course prévue gardés sur la carte. */
const BEFORE_PLAN_MS = 30 * 60_000;

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s: string) => normalize(s).split(/[^a-z0-9]+/u).filter((w) => w.length > 3 && w !== 'angers');

/** Même destination à peu près : le GTFS dit « ANGERS Bois Rinier », le temps réel peut dire « Bois Rinier ». */
export const sameDirection = (destination: string, headsigns: string[]) => {
  const got = new Set(words(destination));
  return headsigns.some((h) => words(h).some((w) => got.has(w)) || normalize(destination).includes(normalize(h)));
};

export type TransitBoard = {
  /** Prochains passages aux arrêts de l'accueil, et perturbations de leurs lignes. */
  departures(): Promise<TransitData>;
  /** Trajet du matin de `ownerId` ; null en dehors de ses heures, sans trajet ou si Irigo ne répond pas. */
  commute(ownerId: string): Promise<Commute | null>;
};

export type TransitBoardDeps = {
  /** Bus et tram ; absent (tests) : ni passages ni trajet. */
  transit?: TransitSource;
  /** Horaires théoriques ; absents : pas de trajet calé sur l'emploi du temps (sauf par MOTIS). */
  gtfs?: GtfsSource;
  /** Itinéraires par MOTIS, essayés avant le calcul maison quand le trajet a ses deux lieux. */
  motis?: MotisSource;
  settings: Pick<TransitSettingsStore, 'homeStops' | 'commuteFor'>;
  /** Cours de `ownerId` sur l'intervalle (null : pas d'emploi du temps, ou indisponible). */
  coursesFor(ownerId: string, range: TimeRange): Promise<SchoolCourse[] | null>;
  clock: Clock;
  logger: Logger;
};

/** Première course à prendre : ligne, arrêt de montée (identifiant GTFS, celui de SIRI), direction, marche avant. */
type Ride = { line: string; origin: string; stopName?: string; headsigns: string[]; oneWay: boolean; walkFrom: number };
type Planned = { ride: Ride; plan: NonNullable<Commute['plan']> };
type FirstCourse = { start: string; earlierCancelled: boolean };

/** Course de la ligne réglée sur la page « Transports » (ou dans le YAML). */
const rideOf = (trip: CommuteTrip): Ride => ({ line: lineLabel(trip.line), origin: trip.origin, headsigns: trip.headsigns, oneWay: trip.oneWay, walkFrom: trip.walkFrom });

export function createTransitBoard({ transit, gtfs, motis, settings, coursesFor, clock, logger }: TransitBoardDeps): TransitBoard {
  const departuresAt = async (stopId: string) =>
    transit ? accessory(logger, 'Irigo indisponible', () => transit.departures(stopId), null) : null;

  const alertsFor = async (lines: string[]) =>
    transit && lines.length > 0 ? accessory(logger, 'Perturbations Irigo indisponibles', () => transit.alerts(lines), []) : [];

  /** Premier cours non annulé d'aujourd'hui, et si un cours plus tôt est annulé ; null sans cours. */
  async function firstCourseOf(ownerId: string, now: Date): Promise<FirstCourse | null> {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const courses = (await coursesFor(ownerId, { from: day, to: next }))?.sort((a, b) => a.start.localeCompare(b.start));
    const first = courses?.find((c) => !c.cancelled);
    if (!courses || !first) return null;
    return { start: first.start, earlierCancelled: courses.some((c) => c.cancelled && c.start < first.start) };
  }

  /**
   * Course à prendre d'après les horaires théoriques (calcul maison) : la dernière de la ligne réglée qui arrive avant
   * le premier cours, marge et marche à l'arrivée comprises. null sans horaires ou sans course qui convienne.
   */
  async function gtfsPlan(trip: CommuteTrip, first: FirstCourse, now: Date): Promise<Planned | null> {
    if (!gtfs || !trip.destination) return null;
    const index = await accessory(logger, 'Horaires Irigo indisponibles', () => gtfs.index(), null);
    if (!index) return null;
    const arriveBy = Date.parse(first.start) - (trip.arriveBefore + trip.walkTo) * 60_000;
    const chosen = index
      .trips({ line: trip.line, origin: trip.origin, destination: trip.destination }, now)
      .filter((t) => t.arrives.getTime() <= arriveBy)
      .at(-1);
    if (!chosen) return null;
    return {
      ride: rideOf(trip),
      plan: {
        departs: chosen.departs.toISOString(),
        arrives: chosen.arrives.toISOString(),
        leaveAt: new Date(chosen.departs.getTime() - trip.walkFrom * 60_000).toISOString(),
        firstCourse: first.start,
        firstCancelled: first.earlierCancelled,
      },
    };
  }

  /**
   * Itinéraire par MOTIS, de lieu à lieu (marche et correspondances comprises), pour arriver avant le premier cours
   * moins la marge : parmi ceux qui arrivent à temps (temps réel compris), celui qui fait partir le plus tard, puis
   * celui qui a le moins de correspondances. null si MOTIS n'est pas configuré, ne répond pas ou ne trouve rien : le
   * calcul maison prend le relais.
   */
  async function motisPlan(trip: CommuteTrip, first: FirstCourse): Promise<Planned | null> {
    if (!motis?.enabled() || !trip.fromPlace || !trip.toPlace) return null;
    const arriveBy = Date.parse(first.start) - trip.arriveBefore * 60_000;
    let itineraries: MotisItinerary[];
    try {
      itineraries = await motis.plan({ from: trip.fromPlace, to: trip.toPlace, time: new Date(arriveBy), arriveBy: true });
    } catch {
      return null; // déjà journalisé par la source
    }
    const best = itineraries
      .map((it) => ({ it, rides: it.legs.filter(isTransitLeg) }))
      .filter(({ it, rides }) => rides.length > 0 && rides.every((r) => !r.cancelled && r.from.stopId) && Date.parse(it.arrives) <= arriveBy)
      .sort((a, b) => Date.parse(b.it.legs[0].scheduledDeparts) - Date.parse(a.it.legs[0].scheduledDeparts) || a.it.transfers - b.it.transfers)[0];
    if (!best) return null;
    const { it, rides } = best;
    const [ride] = rides;
    const leaveAt = it.legs[0].scheduledDeparts;
    return {
      ride: {
        line: ride.line!,
        origin: gtfsStopId(ride.from.stopId!),
        stopName: ride.from.name,
        headsigns: ride.headsign ? [ride.headsign] : [],
        oneWay: !ride.headsign,
        walkFrom: Math.max(0, Math.round((Date.parse(ride.scheduledDeparts) - Date.parse(leaveAt)) / 60_000)),
      },
      plan: {
        departs: ride.scheduledDeparts,
        arrives: it.legs.at(-1)!.scheduledArrives,
        leaveAt,
        firstCourse: first.start,
        firstCancelled: first.earlierCancelled,
        legs: rides.map((r) => ({ line: r.line!, from: r.from.name, to: r.to.name, departs: r.scheduledDeparts, arrives: r.scheduledArrives })),
      },
    };
  }

  /** Trajet selon l'emploi du temps : MOTIS s'il est configuré et répond, sinon le calcul maison. */
  async function planOf(ownerId: string, trip: CommuteTrip, now: Date): Promise<Planned | null> {
    const first = await firstCourseOf(ownerId, now);
    if (!first) return null;
    return (await motisPlan(trip, first)) ?? (await gtfsPlan(trip, first, now));
  }

  return {
    async departures() {
      const stops = (
        await Promise.all(
          settings.homeStops().map(async (stop) => {
            const data = await departuresAt(stop.id);
            if (!data) return null;
            const lines = stop.lines && new Set(stop.lines.map(lineLabel));
            const departures = data.departures.filter((d) => !lines || lines.has(d.line)).slice(0, STOP_DEPARTURES);
            return { id: stop.id, label: stop.label ?? data.name ?? stop.id, departures, lines: stop.lines };
          }),
        )
      ).filter((s) => s !== null);
      const lines = new Set(stops.flatMap((s) => s.lines?.map(lineLabel) ?? s.departures.map((d) => d.line)));
      return { stops: stops.map(({ lines: _, ...stop }) => stop), alerts: await alertsFor([...lines]) };
    },

    /**
     * Selon l'emploi du temps : de `showBefore` minutes avant l'heure de partir jusqu'à peu après la course ; sinon
     * sur la plage horaire fixe du trajet.
     */
    async commute(ownerId) {
      const trip = settings.commuteFor(ownerId);
      if (!trip) return null;
      const now = clock();
      if (!trip.days.includes(now.getDay())) return null;
      let plan: Commute['plan'] | null = null;
      let ride = rideOf(trip);
      if (trip.mode === 'school') {
        const planned = await planOf(ownerId, trip, now);
        if (!planned) return null;
        ({ plan, ride } = planned);
        const from = Date.parse(plan.leaveAt) - trip.showBefore * 60_000;
        if (now.getTime() < from || now.getTime() > Date.parse(plan.departs) + PLAN_LINGER_MS) return null;
      } else {
        const time = localTime(now);
        if (time < trip.window.from || time >= trip.window.to) return null;
      }
      // Temps réel (SIRI) à l'arrêt de la première course : celle de l'itinéraire de MOTIS, ou celle de la ligne réglée.
      const data = await departuresAt(ride.origin);
      if (!data) return null;
      const { line } = ride;
      const departures = data.departures.filter(
        (d) => d.line === line && (ride.oneWay || ride.headsigns.length === 0 || sameDirection(d.destination, ride.headsigns)),
      );
      // La course prévue en tête, même au-delà des premiers passages ; puis les suivantes.
      const planned = plan && departures.find((d) => Math.abs(Date.parse(d.aimed ?? d.at) - Date.parse(plan.departs)) <= SAME_TRIP_MS);
      const kept = departures.filter((d) => !plan || Date.parse(d.at) >= Date.parse(plan.departs) - BEFORE_PLAN_MS || d === planned);
      return {
        line,
        stop: data.name ?? ride.stopName ?? ride.origin,
        ...(trip.label && { label: trip.label }),
        walkMinutes: ride.walkFrom,
        departures: kept.slice(0, COMMUTE_DEPARTURES),
        alerts: await alertsFor([...new Set([line, ...(plan?.legs?.map((l) => l.line) ?? [])])]),
        ...(plan && { plan }),
      };
    },
  };
}
