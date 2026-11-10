// Logique métier : assemble les données des sources pour l'écran d'accueil et les dashboards.
// Ne connaît ni HTTP ni les implémentations des sources (injectées).
import {
  FAMILY_ID,
  type DashboardData,
  type Commute,
  type HomeData,
  type TransitData,
  type Homework,
  type ProfileSummary,
  type Routine,
  type RoutinePeriod,
  type SchoolCourse,
  type SchoolDays,
  type Task,
  type Author,
  type WeatherForecast,
  type WeekData,
} from '../../shared/types.ts';
import { localDay, localTime } from '../../shared/dates.ts';
import type { ConfigProvider, Logger } from '../config-store.ts';
import { createHousehold } from '../household.ts';
import type { GtfsSource } from '../sources/gtfs.ts';
import { lineLabel, type TransitSource } from '../sources/irigo.ts';
import { type CommuteTrip, type TransitSettingsStore, transitSettingsFromConfig } from '../sources/transit-settings.ts';
import type { RoutinePlanStore } from '../sources/routine-plans.ts';
import { currentPeriod, type RoutineStore, stepKey, stepsOn } from '../sources/routines.ts';
import { type Clock, type Sources, startOfWeek, type TimeRange } from '../sources/types.ts';

const UPCOMING_DAYS = 7;
const UPCOMING_LIMIT = 5;
/** Tâches citées dans le résumé de l'accueil. */
const SUMMARY_TASKS = 3;

export type DashboardService = {
  /** Vrai si l'identifiant désigne un membre configuré ou la famille. */
  hasOwner(ownerId: string): boolean;
  home(): Promise<HomeData>;
  /** Prévision détaillée ; null si la météo n'est pas configurée ou indisponible. */
  weatherForecast(): Promise<WeatherForecast | null>;
  /** null si le profil n'existe pas. */
  dashboard(ownerId: string): Promise<DashboardData | null>;
  /** Semaine du lundi `offset` semaines après la semaine en cours (0 à WEEKS_AHEAD, vérifié par l'appelant). */
  week(offset: number): Promise<WeekData>;
  /** null si le profil ou la tâche n'existe pas. */
  setTaskDone(ownerId: string, taskId: string, done: boolean, by?: Author): Promise<Task | null>;
  /** Routine du moment de `ownerId` (appli du téléphone) ; null hors de ses heures, sans étape ou profil inconnu. */
  routine(ownerId: string): Promise<Routine | null>;
  /** Devoirs à faire de `ownerId` (appli du téléphone) ; null sans cahier de texte ou profil inconnu. */
  homework(ownerId: string): Promise<Homework[] | null>;
  /** Prochains passages aux arrêts suivis (accueil, veille). */
  transit(): Promise<TransitData>;
  /** Coche une étape de la routine du jour (`itemId` : `<période>-<rang>`) ; null si elle n'existe pas. */
  setRoutineDone(ownerId: string, itemId: string, done: boolean, by: Author): Promise<Task | null>;
};

export type DashboardServiceDeps = {
  /** Lu à chaque appel : la configuration peut être rechargée à chaud. */
  config: ConfigProvider;
  sources: Sources;
  clock: Clock;
  logger: Logger;
  /** Routines cochées ; absent (tests) : aucune routine. */
  routines?: RoutineStore;
  /** Étapes et heures des routines (page « Routines ») ; absent, comme `routines` : pas de routine. */
  plans?: Pick<RoutinePlanStore, 'current'>;
  /** Bus et tram ; absent (tests) : ni passages ni trajet. */
  transit?: TransitSource;
  /** Réglages de la page « Transports » ; absent : ceux du YAML. */
  transitSettings?: Pick<TransitSettingsStore, 'homeStops' | 'commuteFor'>;
  /** Horaires théoriques, pour un trajet calé sur l'emploi du temps ; absent : pas de tel trajet. */
  gtfs?: GtfsSource;
};

/** Passages gardés par arrêt et pour un trajet. */
const STOP_DEPARTURES = 8;
const COMMUTE_DEPARTURES = 4;
/** Trajet selon l'emploi du temps : la carte reste un moment après l'heure de la course (« Trop tard », suivant). */
const PLAN_LINGER_MS = 5 * 60_000;
/** Écart toléré entre l'horaire théorique du GTFS et celui du temps réel pour reconnaître la même course. */
const SAME_TRIP_MS = 90_000;
const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s: string) => normalize(s).split(/[^a-z0-9]+/u).filter((w) => w.length > 3 && w !== 'angers');
/** Même destination à peu près : le GTFS dit « ANGERS Bois Rinier », le temps réel peut dire « Bois Rinier ». */
const sameDirection = (destination: string, headsigns: string[]) => {
  const got = new Set(words(destination));
  return headsigns.some((h) => words(h).some((w) => got.has(w)) || normalize(destination).includes(normalize(h)));
};

export function createDashboardService(deps: DashboardServiceDeps): DashboardService {
  const { config, sources, clock, logger, routines, plans, transit, gtfs } = deps;
  const transitSettings = deps.transitSettings ?? transitSettingsFromConfig(config);
  const household = createHousehold(config);
  const ownerIds = household.ownerIds;
  const hasOwner = household.isOwner;

  const upcomingRange = () => {
    const from = clock();
    const to = new Date(from);
    to.setDate(to.getDate() + UPCOMING_DAYS);
    return { from, to };
  };

  // La météo est accessoire : une panne de la source masque le bloc au lieu de faire échouer l'écran.
  async function weather() {
    try {
      return await sources.weather.current();
    } catch (err) {
      logger.error(`Météo indisponible : ${(err as Error).message}`);
      return null;
    }
  }

  /** Cours sur l'intervalle. Accessoire, comme la météo : une panne masque l'emploi du temps. */
  async function coursesIn(ownerId: string, range: TimeRange): Promise<SchoolCourse[] | null> {
    try {
      return await sources.school.coursesFor(ownerId, range);
    } catch (err) {
      logger.error(`Emploi du temps indisponible : ${(err as Error).message}`);
      return null;
    }
  }

  /** Cours d'aujourd'hui et de demain. */
  async function schoolDays(ownerId: string): Promise<SchoolDays | null> {
    const today = clock();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const after = new Date(tomorrow);
    after.setDate(after.getDate() + 1);
    const courses = await coursesIn(ownerId, { from: today, to: after });
    if (!courses) return null;
    const startsBefore = (limit: Date) => (c: { start: string }) => new Date(c.start) < limit;
    return {
      today: courses.filter(startsBefore(tomorrow)),
      tomorrow: courses.filter((c) => !startsBefore(tomorrow)(c)),
    };
  }

  /** Devoirs à faire à partir d'aujourd'hui. Accessoires : une panne les masque. */
  async function homeworkOf(ownerId: string): Promise<Homework[] | null> {
    try {
      return (await sources.school.homeworkFor?.(ownerId)) ?? null;
    } catch (err) {
      logger.error(`Devoirs indisponibles : ${(err as Error).message}`);
      return null;
    }
  }

  /** Prochain jour (à partir de demain) qui a des devoirs pas encore faits, pour le rappel de l'accueil. */
  async function nextHomework(ownerId: string): Promise<ProfileSummary['homework']> {
    const list = await homeworkOf(ownerId);
    const today = localDay(clock());
    const left = list?.filter((h) => !h.done && h.due > today) ?? [];
    if (left.length === 0) return null;
    const due = left[0].due;
    return { due, left: left.filter((h) => h.due === due).length };
  }

  /** Passages d'un arrêt ; accessoires, comme la météo : une panne donne null (et un message). */
  async function departuresAt(stopId: string) {
    if (!transit) return null;
    try {
      return await transit.departures(stopId);
    } catch (err) {
      logger.error(`Irigo indisponible : ${(err as Error).message}`);
      return null;
    }
  }

  async function alertsFor(lines: string[]) {
    if (!transit || lines.length === 0) return [];
    try {
      return await transit.alerts(lines);
    } catch (err) {
      logger.error(`Perturbations Irigo indisponibles : ${(err as Error).message}`);
      return [];
    }
  }

  async function transitData(): Promise<TransitData> {
    const stops = (
      await Promise.all(
        transitSettings.homeStops().map(async (stop) => {
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
  }

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
    const courses = (await coursesIn(ownerId, { from: day, to: next }))?.sort((a, b) => a.start.localeCompare(b.start));
    const first = courses?.find((c) => !c.cancelled);
    if (!courses || !first) return null;
    const index = await gtfs.index().catch((err) => {
      logger.error(`Horaires Irigo indisponibles : ${(err as Error).message}`);
      return null;
    });
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

  /**
   * Trajet du matin de `ownerId` : selon l'emploi du temps (de `showBefore` minutes avant l'heure de partir jusqu'à
   * peu après la course), ou sur sa plage horaire fixe ; null en dehors, sans trajet ou si Irigo ne répond pas.
   */
  async function commuteOf(ownerId: string): Promise<Commute | null> {
    const trip = transitSettings.commuteFor(ownerId);
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
    const kept = departures.filter((d) => !plan || Date.parse(d.at) >= Date.parse(plan.departs) - 30 * 60_000 || d === planned);
    return {
      line,
      stop: data.name ?? trip.origin,
      ...(trip.label && { label: trip.label }),
      walkMinutes: trip.walkFrom,
      departures: kept.slice(0, COMMUTE_DEPARTURES),
      alerts: await alertsFor([line]),
      ...(plan && { plan }),
    };
  }

  /** Prochain cours à venir, pour le résumé de l'accueil. */
  async function nextCourse(ownerId: string): Promise<SchoolCourse | null> {
    const range = upcomingRange();
    const courses = await coursesIn(ownerId, range);
    return courses?.find((c) => !c.cancelled && new Date(c.start) >= range.from) ?? null;
  }

  const stepsOf = (ownerId: string, period: RoutinePeriod) => plans?.current().members[ownerId]?.[period] ?? [];

  /**
   * Routine du moment de `ownerId` : étapes prévues aujourd'hui, cochées ou non ; null hors de ses heures ou sans étape
   * prévue. Identifiant d'une étape pour l'API : son rang dans les réglages, qui ne dépend pas du jour.
   */
  async function routineOf(ownerId: string): Promise<Routine | null> {
    const now = clock();
    if (!routines || !plans) return null;
    const period = currentPeriod(now, plans.current().windows);
    if (!period) return null;
    const all = stepsOf(ownerId, period).map((step, i) => ({ ...step, itemId: `${period}-${i}` }));
    const steps = stepsOn(all, now);
    if (steps.length === 0) return null;
    const today = localDay(now);
    const keyOf = (stepId: string) => stepKey(ownerId, period, stepId);
    const [done, streak] = await Promise.all([
      routines.doneOn(today),
      routines.streak((date) => stepsOn(all, date).map((s) => keyOf(s.id)), today),
    ]);
    return {
      period,
      items: steps.map((s) => ({ id: s.itemId, label: s.label, done: done.has(keyOf(s.id)) })),
      streak,
    };
  }

  async function summary(ownerId: string): Promise<ProfileSummary> {
    const [events, course, tasks, notes, routine, homework] = await Promise.all([
      sources.agenda.eventsFor(ownerId, upcomingRange()),
      nextCourse(ownerId),
      sources.tasks.tasksFor(ownerId),
      sources.notes.unseenFor(ownerId),
      routineOf(ownerId),
      nextHomework(ownerId),
    ]);
    const pending = tasks.filter((t) => !t.done);
    return {
      ownerId,
      nextEvent: events[0] ?? null,
      nextCourse: course,
      pendingTasks: pending.length,
      nextTasks: pending.slice(0, SUMMARY_TASKS).map((t) => t.label),
      unreadNotes: notes.length,
      routine: routine && { period: routine.period, done: routine.items.filter((i) => i.done).length, total: routine.items.length },
      homework,
    };
  }

  return {
    hasOwner,

    async home() {
      const [currentWeather, profiles] = await Promise.all([weather(), Promise.all(ownerIds().map(summary))]);
      const family = profiles.find((p) => p.ownerId === FAMILY_ID);
      return { weather: currentWeather, profiles, familyHighlight: family?.nextEvent ?? null };
    },

    async weatherForecast() {
      try {
        return await sources.weather.forecast();
      } catch (err) {
        logger.error(`Météo indisponible : ${(err as Error).message}`);
        return null;
      }
    },

    async dashboard(ownerId) {
      if (!hasOwner(ownerId)) return null;
      const [events, tasks, notes, currentWeather, school, routine, homework, commute] = await Promise.all([
        sources.agenda.eventsFor(ownerId, upcomingRange()),
        sources.tasks.tasksFor(ownerId),
        sources.notes.unseenFor(ownerId),
        weather(),
        schoolDays(ownerId),
        routineOf(ownerId),
        homeworkOf(ownerId),
        commuteOf(ownerId),
      ]);
      const [nextEvent = null, ...rest] = events;
      return {
        ownerId,
        nextEvent,
        upcoming: rest.slice(0, UPCOMING_LIMIT),
        events,
        tasks,
        notes,
        weather: currentWeather,
        school,
        homework,
        commute,
        routine,
      };
    },

    async week(offset) {
      const from = startOfWeek(clock());
      from.setDate(from.getDate() + offset * 7);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      const owners = await Promise.all(
        ownerIds().map(async (ownerId) => {
          const [events, courses] = await Promise.all([
            sources.agenda.eventsFor(ownerId, { from, to }),
            coursesIn(ownerId, { from, to }),
          ]);
          return { ownerId, events, courses };
        }),
      );
      return { start: from.toISOString(), offset, owners };
    },

    async setTaskDone(ownerId, taskId, done, by) {
      if (!hasOwner(ownerId)) return null;
      return sources.tasks.setDone(ownerId, taskId, done, by);
    },

    routine: (ownerId) => (hasOwner(ownerId) ? routineOf(ownerId) : Promise.resolve(null)),
    homework: (ownerId) => (hasOwner(ownerId) ? homeworkOf(ownerId) : Promise.resolve(null)),
    transit: transitData,

    async setRoutineDone(ownerId, itemId, done, by) {
      const match = /^(morning|evening)-(\d+)$/.exec(itemId);
      if (!routines || !match) return null;
      const period = match[1] as RoutinePeriod;
      const step = stepsOf(ownerId, period)[Number(match[2])];
      const now = clock();
      if (!step || stepsOn([step], now).length === 0) return null; // pas prévue aujourd'hui
      await routines.setDone(localDay(now), stepKey(ownerId, period, step.id), done, by);
      return { id: itemId, label: step.label, done };
    },
  };
}
