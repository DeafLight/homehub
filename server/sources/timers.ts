// Minuteurs de la maison (cuisson, écrans, devoirs…), lancés depuis la tablette ou un téléphone et affichés sur la
// tablette. En mémoire seulement : un redémarrage du serveur les perd, ce qui est acceptable pour quelques minutes.
// Un minuteur terminé reste là (la tablette sonne) jusqu'à ce qu'on l'arrête, ou ENDED_KEPT_MS au plus.
import { randomUUID } from 'node:crypto';
import type { Author, Timer } from '../../shared/types.ts';
import type { Clock } from './types.ts';

export const MAX_TIMERS = 6;
export const TIMER_LABEL_MAX = 30;
/** Durée maximale d'un minuteur : 4 h. */
export const TIMER_MAX_SECONDS = 4 * 3600;
const ENDED_KEPT_MS = 30 * 60_000;

export type TimerStore = {
  /** Minuteurs en cours et terminés (non arrêtés), du plus proche de la fin au plus lointain. */
  list(): Timer[];
  /** null : déjà MAX_TIMERS minuteurs. */
  start(label: string, seconds: number, by: Author): Timer | null;
  stop(id: string): boolean;
};

export function createTimerStore(clock: Clock): TimerStore {
  const timers = new Map<string, Timer>();
  const now = () => clock().getTime();

  function prune() {
    for (const [id, timer] of timers) if (new Date(timer.endsAt).getTime() + ENDED_KEPT_MS < now()) timers.delete(id);
  }

  return {
    list() {
      prune();
      return [...timers.values()].sort((a, b) => a.endsAt.localeCompare(b.endsAt));
    },

    start(label, seconds, by) {
      prune();
      if (timers.size >= MAX_TIMERS) return null;
      const timer: Timer = {
        id: randomUUID(),
        label,
        durationSeconds: seconds,
        startedAt: new Date(now()).toISOString(),
        endsAt: new Date(now() + seconds * 1000).toISOString(),
        startedBy: by,
      };
      timers.set(timer.id, timer);
      return timer;
    },

    stop(id) {
      return timers.delete(id);
    },
  };
}
