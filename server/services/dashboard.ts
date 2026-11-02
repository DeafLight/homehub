// Logique métier : assemble les données des sources pour l'écran d'accueil et les dashboards.
// Ne connaît ni HTTP ni les implémentations des sources (injectées).
import { FAMILY_ID, type DashboardData, type HomeData, type ProfileSummary, type Task } from '../../shared/types.ts';
import type { ConfigProvider } from '../config-store.ts';
import type { Clock, Sources } from '../sources/types.ts';

const UPCOMING_DAYS = 7;
const UPCOMING_LIMIT = 5;

export type DashboardService = {
  /** Vrai si l'identifiant désigne un membre configuré ou la famille. */
  hasOwner(ownerId: string): boolean;
  home(): Promise<HomeData>;
  /** null si le profil n'existe pas. */
  dashboard(ownerId: string): Promise<DashboardData | null>;
  /** null si le profil ou la tâche n'existe pas. */
  setTaskDone(ownerId: string, taskId: string, done: boolean): Promise<Task | null>;
};

export type DashboardServiceDeps = {
  /** Lu à chaque appel : la configuration peut être rechargée à chaud. */
  config: ConfigProvider;
  sources: Sources;
  clock: Clock;
};

export function createDashboardService({ config, sources, clock }: DashboardServiceDeps): DashboardService {
  const ownerIds = () => [...config.current().members.map((m) => m.id), FAMILY_ID];
  const hasOwner = (ownerId: string) => ownerIds().includes(ownerId);

  const upcomingRange = () => {
    const from = clock();
    const to = new Date(from);
    to.setDate(to.getDate() + UPCOMING_DAYS);
    return { from, to };
  };

  async function summary(ownerId: string): Promise<ProfileSummary> {
    const [events, tasks] = await Promise.all([
      sources.agenda.eventsFor(ownerId, upcomingRange()),
      sources.tasks.tasksFor(ownerId),
    ]);
    return {
      ownerId,
      nextEvent: events[0] ?? null,
      pendingTasks: tasks.filter((t) => !t.done).length,
    };
  }

  return {
    hasOwner,

    async home() {
      const [weather, profiles] = await Promise.all([
        sources.weather.current(),
        Promise.all(ownerIds().map(summary)),
      ]);
      const family = profiles.find((p) => p.ownerId === FAMILY_ID);
      return { weather, profiles, familyHighlight: family?.nextEvent ?? null };
    },

    async dashboard(ownerId) {
      if (!hasOwner(ownerId)) return null;
      const [events, tasks, note, weather] = await Promise.all([
        sources.agenda.eventsFor(ownerId, upcomingRange()),
        sources.tasks.tasksFor(ownerId),
        sources.notes.latestFor(ownerId),
        sources.weather.current(),
      ]);
      const [nextEvent = null, ...rest] = events;
      return { ownerId, nextEvent, upcoming: rest.slice(0, UPCOMING_LIMIT), tasks, note, weather };
    },

    async setTaskDone(ownerId, taskId, done) {
      if (!hasOwner(ownerId)) return null;
      return sources.tasks.setDone(ownerId, taskId, done);
    },
  };
}
