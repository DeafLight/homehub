// Bus et tram pour les écrans, sans HTTP : prochains passages aux arrêts de l'accueil, et trajet du matin d'un membre
// (carte « Pars dans N min »), sur sa plage horaire fixe ou calé sur son emploi du temps : la dernière course qui
// arrive avant le premier cours, d'après les horaires théoriques, reconnue ensuite dans le temps réel.
import { localTime } from '../../shared/dates.ts';
import type { Commute, SchoolCourse, TransitData } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import type { GtfsSource } from '../sources/gtfs.ts';
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
  /** Horaires théoriques ; absents : pas de trajet calé sur l'emploi du temps. */
  gtfs?: GtfsSource;
  settings: Pick<TransitSettingsStore, 'homeStops' | 'commuteFor'>;
  /** Cours de `ownerId` sur l'intervalle (null : pas d'emploi du temps, ou indisponible). */
  coursesFor(ownerId: string, range: TimeRange): Promise<SchoolCourse[] | null>;
  clock: Clock;
  logger: Logger;
};

export function createTransitBoard({ transit, gtfs, settings, coursesFor, clock, logger }: TransitBoardDeps): TransitBoard {
  const departuresAt = async (stopId: string) =>
    transit ? accessory(logger, 'Irigo indisponible', () => transit.departures(stopId), null) : null;

  const alertsFor = async (lines: string[]) =>
    transit && lines.length > 0 ? accessory(logger, 'Perturbations Irigo indisponibles', () => transit.alerts(lines), []) : [];

  /**
   * Course à prendre aujourd'hui pour arriver avant le premier cours non annulé (marge et marche à l'arrivée
   * comprises) : la dernière qui arrive à temps, d'après les horaires théoriques. null sans cours, sans horaires ou
   * sans course qui convienne.
   */
  async function planOf(ownerId: string, trip: CommuteTrip, now: Date): Promise<Commute['plan'] | null> {
    if (!gtfs || !trip.destination) return null;
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const courses = (await coursesFor(ownerId, { from: day, to: next }))?.sort((a, b) => a.start.localeCompare(b.start));
    const first = courses?.find((c) => !c.cancelled);
    if (!courses || !first) return null;
    const index = await accessory(logger, 'Horaires Irigo indisponibles', () => gtfs.index(), null);
    if (!index) return null;
    const arriveBy = Date.parse(first.start) - (trip.arriveBefore + trip.walkTo) * 60_000;
    const chosen = index
      .trips({ line: trip.line, origin: trip.origin, destination: trip.destination }, now)
      .filter((t) => t.arrives.getTime() <= arriveBy)
      .at(-1);
    if (!chosen) return null;
    return {
      departs: chosen.departs.toISOString(),
      arrives: chosen.arrives.toISOString(),
      leaveAt: new Date(chosen.departs.getTime() - trip.walkFrom * 60_000).toISOString(),
      firstCourse: first.start,
      firstCancelled: courses.some((c) => c.cancelled && c.start < first.start),
    };
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
      if (trip.mode === 'school') {
        plan = await planOf(ownerId, trip, now);
        if (!plan) return null;
        const from = Date.parse(plan.leaveAt) - trip.showBefore * 60_000;
        if (now.getTime() < from || now.getTime() > Date.parse(plan.departs) + PLAN_LINGER_MS) return null;
      } else {
        const time = localTime(now);
        if (time < trip.window.from || time >= trip.window.to) return null;
      }
      const data = await departuresAt(trip.origin);
      if (!data) return null;
      const line = lineLabel(trip.line);
      const departures = data.departures.filter(
        (d) => d.line === line && (trip.oneWay || trip.headsigns.length === 0 || sameDirection(d.destination, trip.headsigns)),
      );
      // La course prévue en tête, même au-delà des premiers passages ; puis les suivantes.
      const planned = plan && departures.find((d) => Math.abs(Date.parse(d.aimed ?? d.at) - Date.parse(plan.departs)) <= SAME_TRIP_MS);
      const kept = departures.filter((d) => !plan || Date.parse(d.at) >= Date.parse(plan.departs) - BEFORE_PLAN_MS || d === planned);
      return {
        line,
        stop: data.name ?? trip.origin,
        ...(trip.label && { label: trip.label }),
        walkMinutes: trip.walkFrom,
        departures: kept.slice(0, COMMUTE_DEPARTURES),
        alerts: await alertsFor([line]),
        ...(plan && { plan }),
      };
    },
  };
}
