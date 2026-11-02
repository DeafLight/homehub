// Briques communes aux tests : configuration, horloge fixe et sources factices.
import type { CalendarEvent, Task } from '../shared/types.ts';
import { type AppConfig, parseConfig } from './config.ts';
import type { Clock, Sources } from './sources/types.ts';

/** Lundi 2 novembre 2026, 18:00 heure locale. */
export const NOW = new Date(2026, 10, 2, 18, 0);
export const fixedClock: Clock = () => new Date(NOW);

export const testConfig: AppConfig = parseConfig({
  members: [
    { id: 'alex', name: 'Alex', color: '#5b8def' },
    { id: 'lea', name: 'Léa', color: '#3fb8a8' },
  ],
});

export function event(id: string, hoursFromNow: number, title = id): CalendarEvent {
  return { id, title, start: new Date(NOW.getTime() + hoursFromNow * 3_600_000).toISOString() };
}

/** Sources en mémoire, alimentées par profil. */
export function fakeSources(data: {
  events?: Record<string, CalendarEvent[]>;
  tasks?: Record<string, Task[]>;
} = {}): Sources {
  const tasks = structuredClone(data.tasks ?? {});
  return {
    agenda: {
      async eventsFor(ownerId, range) {
        return (data.events?.[ownerId] ?? []).filter((e) => {
          const start = new Date(e.start);
          return start >= range.from && start < range.to;
        });
      },
    },
    tasks: {
      async tasksFor(ownerId) {
        return tasks[ownerId] ?? [];
      },
      async setDone(ownerId, taskId, done) {
        const task = tasks[ownerId]?.find((t) => t.id === taskId);
        if (!task) return null;
        task.done = done;
        return task;
      },
    },
    notes: { async latestFor() { return { text: 'Coucou', authorId: 'alex' }; } },
    weather: { async current() { return { temperatureC: 10, condition: 'Nuageux', outlook: 'Stable' }; } },
  };
}
