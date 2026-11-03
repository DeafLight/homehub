// Logique métier : assemble les données des sources pour l'écran d'accueil et les dashboards.
// Ne connaît ni HTTP ni les implémentations des sources (injectées).
import {
  FAMILY_ID,
  type DashboardData,
  type HomeData,
  type ProfileSummary,
  type SchoolCourse,
  type SchoolDays,
  type Task,
  type Author,
  type WeatherForecast,
  type WeekData,
} from '../../shared/types.ts';
import type { ConfigProvider, Logger } from '../config-store.ts';
import { type Clock, type Sources, startOfWeek, type TimeRange } from '../sources/types.ts';

const UPCOMING_DAYS = 7;
const UPCOMING_LIMIT = 5;

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
};

export type DashboardServiceDeps = {
  /** Lu à chaque appel : la configuration peut être rechargée à chaud. */
  config: ConfigProvider;
  sources: Sources;
  clock: Clock;
  logger: Logger;
};

export function createDashboardService({ config, sources, clock, logger }: DashboardServiceDeps): DashboardService {
  const ownerIds = () => [...config.current().members.map((m) => m.id), FAMILY_ID];
  const hasOwner = (ownerId: string) => ownerIds().includes(ownerId);

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

  /** Prochain cours à venir, pour le résumé de l'accueil. */
  async function nextCourse(ownerId: string): Promise<SchoolCourse | null> {
    const range = upcomingRange();
    const courses = await coursesIn(ownerId, range);
    return courses?.find((c) => !c.cancelled && new Date(c.start) >= range.from) ?? null;
  }

  async function summary(ownerId: string): Promise<ProfileSummary> {
    const [events, course, tasks] = await Promise.all([
      sources.agenda.eventsFor(ownerId, upcomingRange()),
      nextCourse(ownerId),
      sources.tasks.tasksFor(ownerId),
    ]);
    return {
      ownerId,
      nextEvent: events[0] ?? null,
      nextCourse: course,
      pendingTasks: tasks.filter((t) => !t.done).length,
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
      const [events, tasks, notes, currentWeather, school] = await Promise.all([
        sources.agenda.eventsFor(ownerId, upcomingRange()),
        sources.tasks.tasksFor(ownerId),
        sources.notes.unseenFor(ownerId),
        weather(),
        schoolDays(ownerId),
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
  };
}
