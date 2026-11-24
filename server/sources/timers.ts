// Minuteurs de la maison (cuisson, écrans, devoirs…), lancés depuis la tablette ou un téléphone et affichés sur la
// tablette. Enregistrés dans le dossier d'état (timers.json) à chaque changement et relus au démarrage : un
// redémarrage du serveur (mise à jour) ne les perd pas ; celui qui s'est terminé pendant ce temps sonne au retour.
// Un minuteur terminé reste là (la tablette sonne) jusqu'à ce qu'on l'arrête, ou ENDED_KEPT_MS au plus.
// « +1 min » du mode cuisine : un minuteur qui sonne (ou arrêté en sonnant depuis moins de RELAUNCH_WINDOW_MS) repart
// sous un nouvel identifiant, même nom, même auteur : partout, l'ancien s'arrête et le nouveau sonnera à son tour.
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { type Author, type Timer, TIMER_MAX_SECONDS } from '../../shared/types.ts';
import { authorSchema } from './schemas.ts';
import type { Clock } from './types.ts';

export const MAX_TIMERS = 6;
export const TIMER_LABEL_MAX = 30;
export { TIMER_MAX_SECONDS };
const ENDED_KEPT_MS = 30 * 60_000;
/** Délai pendant lequel un minuteur arrêté en sonnant peut encore être relancé (« +1 min » puis 5 s d'attente). */
export const RELAUNCH_WINDOW_MS = 2 * 60_000;

const timerSchema = z.object({
  id: z.string(),
  label: z.string(),
  durationSeconds: z.number(),
  startedAt: z.string(),
  endsAt: z.string(),
  startedBy: authorSchema,
});
const fileSchema = z.object({ version: z.literal(1), timers: z.array(timerSchema) });

export type TimerStore = {
  /** Minuteurs en cours et terminés (non arrêtés), du plus proche de la fin au plus lointain. */
  list(): Timer[];
  /** null : déjà MAX_TIMERS minuteurs. */
  start(label: string, seconds: number, by: Author): Timer | null;
  stop(id: string): boolean;
  /** Minuteur qui sonne, ou arrêté en sonnant il y a peu : relancé pour `seconds` (null : inconnu, ou trop de minuteurs). */
  relaunch(id: string, seconds: number): Timer | null;
  /** Le minuteur sonne, ou vient d'être arrêté en sonnant (il peut être relancé). */
  relaunchable(id: string): boolean;
};

export type TimerStoreOptions = {
  clock: Clock;
  /** Fichier où les garder ; absent (tests) : en mémoire seulement. */
  path?: string;
  logger?: Pick<Console, 'error'>;
};

export function createTimerStore({ clock, path, logger = console }: TimerStoreOptions): TimerStore {
  const timers = new Map<string, Timer>();
  /** Arrêtés en sonnant, avec l'heure de l'arrêt (en mémoire seulement : la fenêtre est courte). */
  const silenced = new Map<string, { timer: Timer; at: number }>();
  const now = () => clock().getTime();
  const ended = (timer: Timer) => new Date(timer.endsAt).getTime() <= now();

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
    for (const [id, { at }] of silenced) if (at + RELAUNCH_WINDOW_MS < now()) silenced.delete(id);
    let removed = false;
    for (const [id, timer] of timers) {
      if (new Date(timer.endsAt).getTime() + ENDED_KEPT_MS < now()) removed = timers.delete(id) || removed;
    }
    if (removed) save();
  }

  /** Le minuteur à relancer : il sonne, ou il a été arrêté en sonnant il y a peu. */
  function toRelaunch(id: string): Timer | undefined {
    prune();
    const timer = timers.get(id);
    if (timer) return ended(timer) ? timer : undefined;
    return silenced.get(id)?.timer;
  }

  function start(label: string, seconds: number, by: Author): Timer | null {
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
  }

  return {
    list() {
      prune();
      return [...timers.values()].sort((a, b) => a.endsAt.localeCompare(b.endsAt));
    },

    start,

    stop(id) {
      const timer = timers.get(id);
      if (!timer) return false;
      if (ended(timer)) silenced.set(id, { timer, at: now() });
      timers.delete(id);
      save();
      return true;
    },

    relaunchable: (id) => toRelaunch(id) !== undefined,

    relaunch(id, seconds) {
      const old = toRelaunch(id);
      if (!old) return null;
      const removed = timers.delete(id);
      silenced.delete(id);
      const timer = start(old.label, seconds, old.startedBy);
      if (!timer && removed) save();
      return timer;
    },
  };
}
