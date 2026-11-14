// Séances de sport guidées sur la télé (fonction 12), en mémoire seulement. Une séance appartient à la personne dont
// le téléphone l'a lancée : elle seule la pilote (pause, suivant, arrêter) et la note. Le serveur tient l'horloge
// (shared/screen-workout.ts) ; la télé suit par interrogation longue (`rev` change à chaque ordre). À la fin, finie ou
// arrêtée, la télé reçoit l'ordre de tout effacer (bandeau « Séance terminée ») et ne voit plus rien ; le téléphone
// garde la séance (phase « done ») jusqu'à ce qu'il la note ou l'abandonne, ou au plus DONE_TTL_MS.
import { randomUUID } from 'node:crypto';
import { workoutSteps, type WorkoutStep } from '../../shared/fitness-workout.ts';
import type { SessionNumber } from '../../shared/fitness.ts';
import { SCREEN_WORKOUT_PAGE, type ScreenWorkoutEvent } from '../../shared/screen.ts';
import {
  commandClock,
  type PhoneScreenWorkout,
  remainingMs,
  type ScreenWorkoutCommand,
  type ScreenWorkoutPlan,
  type ScreenWorkoutState,
  settleClock,
  startClock,
  type WorkoutClock,
} from '../../shared/screen-workout.ts';
import { fail, HttpError } from '../http.ts';
import type { Clock } from '../sources/types.ts';
import { WAIT_MS } from './live-camera.ts';
import type { ScreenHub } from './screens.ts';

/** Attente du compte rendu de la télé au lancement : ouvrir la page prend une ou deux secondes. */
export const START_REPORT_MS = 10_000;
/** Attente du compte rendu de la fin : personne ne l'attend vraiment, la télé s'efface d'elle-même. */
export const END_REPORT_MS = 5_000;
/** Une séance finie reste lisible par le téléphone ce temps-là (pour la noter), puis est oubliée. */
export const DONE_TTL_MS = 2 * 60 * 60_000;

export const SCREEN_BUSY = 'La télé est déjà prise par la séance de quelqu’un d’autre';
export const NO_SCREEN_WORKOUT = 'Pas de séance en cours sur la télé';

type Workout = {
  ownerId: string;
  screen: { id: string; name: string };
  session: SessionNumber;
  plan: ScreenWorkoutPlan;
  steps: WorkoutStep[];
  clock: WorkoutClock;
  /** La télé a reçu l'ordre de tout effacer (ou n'a jamais ouvert la page). */
  ended: boolean;
  endedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

export type ScreenWorkouts = ReturnType<typeof createScreenWorkouts>;

export function createScreenWorkouts({ clock, hub, waitMs = WAIT_MS }: { clock: Clock; hub: ScreenHub; waitMs?: number }) {
  const byOwner = new Map<string, Workout>();
  const revs = new Map<string, number>();
  const waiters = new Map<string, Set<() => void>>();
  const now = () => clock().getTime();

  const revOf = (screenId: string) => revs.get(screenId) ?? 0;
  const bump = (screenId: string) => {
    revs.set(screenId, revOf(screenId) + 1);
    for (const wake of waiters.get(screenId) ?? []) wake();
    waiters.delete(screenId);
  };

  /** Séance affichée sur la télé `screenId`, s'il y en a une. */
  const liveOn = (screenId: string) => [...byOwner.values()].find((w) => w.screen.id === screenId && !w.ended);

  /** Fin de la séance (finie ou arrêtée) : la télé efface tout. */
  function finish(w: Workout) {
    if (w.timer) clearTimeout(w.timer);
    w.timer = null;
    if (w.ended) return;
    w.ended = true;
    w.endedAt = now();
    bump(w.screen.id);
    const notice = w.clock.stopped ? { title: 'Séance arrêtée', subtitle: 'L’écran est effacé' } : { title: 'Séance terminée', subtitle: 'Bravo !' };
    const event: ScreenWorkoutEvent = { kind: 'workout', id: randomUUID(), action: 'end', page: SCREEN_WORKOUT_PAGE, notice };
    // Télé absente : rien à effacer de plus (la page, si elle revient, ne trouve plus de séance et se ferme).
    void hub.send(w.screen.id, event, END_REPORT_MS).catch(() => {});
  }

  /** L'horloge à l'heure, et la fin si la dernière étape est écoulée. */
  function settle(w: Workout) {
    w.clock = settleClock(w.clock, w.steps, now());
    if (w.clock.finished) finish(w);
  }

  /** Réveil à la fin prévue de la séance, pour effacer la télé même si personne ne demande rien. */
  function schedule(w: Workout) {
    if (w.timer) clearTimeout(w.timer);
    w.timer = null;
    if (w.clock.finished || w.clock.paused) return;
    w.timer = setTimeout(() => settle(w), remainingMs(w.clock, w.steps) + 250);
    w.timer.unref?.();
  }

  /** Séance de `ownerId`, à l'heure ; une séance finie depuis trop longtemps est oubliée. */
  function current(ownerId: string): Workout | null {
    const w = byOwner.get(ownerId);
    if (!w) return null;
    settle(w);
    if (w.ended && now() - w.endedAt > DONE_TTL_MS) {
      byOwner.delete(ownerId);
      return null;
    }
    return w;
  }

  const phoneView = (w: Workout): PhoneScreenWorkout => ({
    rev: revOf(w.screen.id),
    screen: w.screen,
    session: w.session,
    plan: w.plan,
    index: w.clock.index,
    left: w.clock.left,
    paused: w.clock.paused,
    phase: w.ended ? 'done' : 'running',
    stopped: w.clock.stopped,
  });

  function screenState(screenId: string): ScreenWorkoutState {
    const w = liveOn(screenId);
    if (w) settle(w);
    const live = liveOn(screenId);
    return {
      rev: revOf(screenId),
      workout: live ? { plan: live.plan, index: live.clock.index, left: live.clock.left, paused: live.clock.paused } : null,
    };
  }

  /** Arrête et oublie la séance de `ownerId`, la télé effacée. */
  function drop(ownerId: string) {
    const w = byOwner.get(ownerId);
    if (!w) return;
    if (!w.ended) {
      w.clock = { ...w.clock, finished: true, stopped: true, paused: false };
      finish(w);
    }
    byOwner.delete(ownerId);
  }

  return {
    /**
     * Lance la séance `session` de `ownerId` sur la télé : la page s'ouvre, l'horloge part. Une séance de la même
     * personne encore en cours est arrêtée ; la télé occupée par quelqu'un d'autre : 409. Télé absente : 503 ; elle
     * n'a pas pu ouvrir la page : 502.
     */
    async start(o: { ownerId: string; screen: { id: string; name: string }; session: SessionNumber; plan: ScreenWorkoutPlan }): Promise<PhoneScreenWorkout> {
      const other = liveOn(o.screen.id);
      if (other) settle(other);
      if (liveOn(o.screen.id) && liveOn(o.screen.id)!.ownerId !== o.ownerId) return fail(409, SCREEN_BUSY);
      drop(o.ownerId);
      const steps = workoutSteps(o.plan);
      const w: Workout = { ...o, steps, clock: startClock(steps, now()), ended: false, endedAt: 0, timer: null };
      byOwner.set(o.ownerId, w);
      bump(o.screen.id);
      const event: ScreenWorkoutEvent = { kind: 'workout', id: randomUUID(), action: 'start', page: SCREEN_WORKOUT_PAGE };
      let failure: HttpError | null = null;
      try {
        const report = await hub.send(o.screen.id, event, START_REPORT_MS);
        if (!report.ok) failure = new HttpError(502, `${o.screen.name} : ${report.reason}`);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        failure = err;
      }
      if (failure) {
        // La page n'est pas ouverte : rien à effacer, la séance n'a pas commencé.
        w.ended = true;
        byOwner.delete(o.ownerId);
        bump(o.screen.id);
        throw failure;
      }
      // L'horloge part quand la page est ouverte, pas pendant son chargement.
      w.clock = startClock(steps, now());
      bump(o.screen.id);
      schedule(w);
      return phoneView(w);
    },

    /** La séance de `ownerId` (en cours, ou finie et pas encore notée), ou null. */
    phone(ownerId: string): PhoneScreenWorkout | null {
      const w = current(ownerId);
      return w ? phoneView(w) : null;
    },

    /** Pause ou reprise, étape suivante, arrêt ; 404 sans séance. */
    command(ownerId: string, command: ScreenWorkoutCommand): PhoneScreenWorkout {
      const w = current(ownerId) ?? fail(404, NO_SCREEN_WORKOUT);
      if (w.ended) return phoneView(w);
      w.clock = commandClock(w.clock, w.steps, command, now());
      bump(w.screen.id);
      if (w.clock.finished) finish(w);
      else schedule(w);
      return phoneView(w);
    },

    /** Séance notée ou abandonnée : oubliée (la télé effacée si elle défilait encore). */
    dismiss(ownerId: string) {
      drop(ownerId);
    },

    /** Ce que montre la télé `screenId`. */
    screenState,

    /** La même chose, par interrogation longue : répond dès que `rev` dépasse `after`, ou au bout de `waitMs`. */
    async waitScreen(screenId: string, after: number | null, abort?: AbortSignal): Promise<ScreenWorkoutState> {
      const deadline = performance.now() + waitMs;
      while (after !== null && revOf(screenId) <= after && !abort?.aborted && performance.now() < deadline) {
        await new Promise<void>((resolve) => {
          const set = waiters.get(screenId) ?? new Set();
          waiters.set(screenId, set);
          const done = () => {
            clearTimeout(timer);
            set.delete(done);
            abort?.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, deadline - performance.now());
          set.add(done);
          abort?.addEventListener('abort', done, { once: true });
        });
      }
      return screenState(screenId);
    },
  };
}
