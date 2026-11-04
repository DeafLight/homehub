// Minuteurs de la maison (cuisson, écrans, devoirs…), lancés depuis la tablette ou un téléphone et affichés sur la
// tablette. Enregistrés dans le dossier d'état (timers.json) à chaque changement et relus au démarrage : un
// redémarrage du serveur (mise à jour) ne les perd pas ; celui qui s'est terminé pendant ce temps sonne au retour.
// Un minuteur terminé reste là (la tablette sonne) jusqu'à ce qu'on l'arrête, ou ENDED_KEPT_MS au plus.
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { type Author, type Timer, TIMER_MAX_SECONDS } from '../../shared/types.ts';
import type { Clock } from './types.ts';

export const MAX_TIMERS = 6;
export const TIMER_LABEL_MAX = 30;
export { TIMER_MAX_SECONDS };
const ENDED_KEPT_MS = 30 * 60_000;

const timerSchema = z.object({
  id: z.string(),
  label: z.string(),
  durationSeconds: z.number(),
  startedAt: z.string(),
  endsAt: z.string(),
  startedBy: z.object({ ownerId: z.string().nullable(), via: z.enum(['tablet', 'phone']) }),
});
const fileSchema = z.object({ version: z.literal(1), timers: z.array(timerSchema) });

export type TimerStore = {
  /** Minuteurs en cours et terminés (non arrêtés), du plus proche de la fin au plus lointain. */
  list(): Timer[];
  /** null : déjà MAX_TIMERS minuteurs. */
  start(label: string, seconds: number, by: Author): Timer | null;
  stop(id: string): boolean;
};

export type TimerStoreOptions = {
  clock: Clock;
  /** Fichier où les garder ; absent (tests) : en mémoire seulement. */
  path?: string;
  logger?: Pick<Console, 'error'>;
};

export function createTimerStore({ clock, path, logger = console }: TimerStoreOptions): TimerStore {
  const timers = new Map<string, Timer>();
  const now = () => clock().getTime();

  if (path) {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      if (parsed.success) for (const timer of parsed.data.timers) timers.set(timer.id, timer);
      else logger.error(`${path} illisible, minuteurs ignorés :\n${z.prettifyError(parsed.error)}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.error(`${path} illisible, minuteurs ignorés : ${err}`);
    }
  }

  /** Écrit l'état (petit fichier, écriture atomique). Un échec n'arrête pas le minuteur : il est signalé. */
  function save() {
    if (!path) return;
    try {
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, timers: [...timers.values()] }), { mode: 0o600 });
      renameSync(tmp, path);
    } catch (err) {
      logger.error(`Minuteurs : écriture de ${path} impossible : ${err}`);
    }
  }

  function prune() {
    let removed = false;
    for (const [id, timer] of timers) {
      if (new Date(timer.endsAt).getTime() + ENDED_KEPT_MS < now()) removed = timers.delete(id) || removed;
    }
    if (removed) save();
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
      save();
      return timer;
    },

    stop(id) {
      const removed = timers.delete(id);
      if (removed) save();
      return removed;
    },
  };
}
