// Séance de sport guidée sur la télé (fonction 12 de l'appli HomeHub TV), lancée et pilotée par le téléphone de la
// personne. Le serveur tient l'horloge de la séance (étape en cours, fin prévue, pause) ; la télé et le téléphone en
// reçoivent une vue et font défiler le compte à rebours eux-mêmes entre deux nouvelles. Fonctions pures, communes au
// serveur et au front.
//
// Règle 4 du dépôt : la télé est un écran partagé. Elle ne reçoit que la séance en cours (exercices, rythme, tours,
// étape, temps restant) : ni le prénom, ni le numéro de séance, ni le palier, ni l'historique, ni les mesures. À la fin,
// elle efface tout ; le résultat ne s'enregistre que depuis le téléphone (POST /api/fitness/sessions).
import { type FitnessState, PALIERS, planSession, type SessionNumber } from './fitness.ts';
import { type TabletSession, type WorkoutStep } from './fitness-workout.ts';

/** Ce que la télé reçoit pour dérouler la séance : le rythme et les exercices, rien d'autre. */
export type ScreenWorkoutPlan = Pick<TabletSession, 'rounds' | 'effort' | 'rest' | 'exercises'>;

/** Séance `session` du programme, pour la télé. */
export function screenPlanOf(state: FitnessState, session: SessionNumber): ScreenWorkoutPlan {
  return {
    rounds: PALIERS[state.palier].rounds,
    effort: state.effort,
    rest: state.rest,
    exercises: planSession(state, session).map(({ family, exercise }) => ({ family, id: exercise.id })),
  };
}

/** Ordres du téléphone : pause ou reprise, étape suivante, arrêt. */
export const SCREEN_WORKOUT_COMMANDS = ['pause', 'next', 'stop'] as const;
export type ScreenWorkoutCommand = (typeof SCREEN_WORKOUT_COMMANDS)[number];

/**
 * Horloge de la séance, côté serveur. `endsAt` : heure (ms) de fin de l'étape en cours, périmée pendant la pause ;
 * `left` : millisecondes restantes de l'étape à la dernière mise à jour.
 */
export type WorkoutClock = { index: number; endsAt: number; left: number; paused: boolean; finished: boolean; stopped: boolean };

function enter(clock: WorkoutClock, steps: readonly WorkoutStep[], index: number, now: number): WorkoutClock {
  const ms = steps[index].seconds * 1000;
  return { ...clock, index, endsAt: now + ms, left: ms };
}

export function startClock(steps: readonly WorkoutStep[], now: number): WorkoutClock {
  const idle: WorkoutClock = { index: 0, endsAt: now, left: 0, paused: false, finished: !steps.length, stopped: false };
  return steps.length ? enter(idle, steps, 0, now) : idle;
}

/** L'horloge à l'heure `now` : les étapes écoulées sont passées, la dernière finie termine la séance. */
export function settleClock(clock: WorkoutClock, steps: readonly WorkoutStep[], now: number): WorkoutClock {
  if (clock.finished || clock.paused) return clock;
  let next = clock;
  while (now >= next.endsAt) {
    if (next.index + 1 >= steps.length) return { ...next, left: 0, finished: true };
    const from = next.endsAt;
    next = enter(next, steps, next.index + 1, from);
  }
  return { ...next, left: next.endsAt - now };
}

/** Un ordre du téléphone, appliqué à l'heure `now`. */
export function commandClock(clock: WorkoutClock, steps: readonly WorkoutStep[], command: ScreenWorkoutCommand, now: number): WorkoutClock {
  const current = settleClock(clock, steps, now);
  if (current.finished) return current;
  switch (command) {
    case 'pause':
      return current.paused ? { ...current, paused: false, endsAt: now + current.left } : { ...current, paused: true };
    case 'next':
      if (current.index + 1 >= steps.length) return { ...current, left: 0, paused: false, finished: true };
      // Passer pendant la pause : on reste en pause, au début de l'étape suivante.
      return enter(current, steps, current.index + 1, now);
    case 'stop':
      return { ...current, paused: false, finished: true, stopped: true };
  }
}

/** Millisecondes restantes de toute la séance (0 en pause : rien n'est à prévoir). */
export function remainingMs(clock: WorkoutClock, steps: readonly WorkoutStep[]): number {
  if (clock.finished) return 0;
  return clock.left + steps.slice(clock.index + 1).reduce((sum, s) => sum + s.seconds * 1000, 0);
}

/** Où en est la séance, pour la télé et le téléphone : `left` en millisecondes, compté à l'envoi de la réponse. */
export type WorkoutPosition = { index: number; left: number; paused: boolean };

/** Séance en cours vue par la télé (GET /api/screen/workout) ; null : aucune, l'écran est vide. */
export type ScreenWorkoutLive = WorkoutPosition & { plan: ScreenWorkoutPlan };
/** `rev` change à chaque ordre du téléphone, au début et à la fin : la télé attend le suivant (interrogation longue). */
export type ScreenWorkoutState = { rev: number; workout: ScreenWorkoutLive | null };

/** La séance sur la télé, vue du téléphone de la personne qui l'a lancée. */
export type PhoneScreenWorkout = WorkoutPosition & {
  rev: number;
  screen: { id: string; name: string };
  session: SessionNumber;
  plan: ScreenWorkoutPlan;
  /** running : la séance défile ; done : finie ou arrêtée, la télé est effacée, la note reste à faire ici. */
  phase: 'running' | 'done';
  stopped: boolean;
};

/** Une télé où lancer la séance (onglet Sport du téléphone). */
export type WorkoutScreen = { id: string; name: string; online: boolean };

/** Vue locale : l'horloge reçue (`left` à l'heure `receivedAt`) recalée à l'heure `now`, étapes écoulées passées. */
export function positionAt(position: WorkoutPosition, steps: readonly WorkoutStep[], receivedAt: number, now: number): WorkoutPosition & { finished: boolean } {
  const clock: WorkoutClock = { index: position.index, endsAt: receivedAt + position.left, left: position.left, paused: position.paused, finished: false, stopped: false };
  const settled = settleClock(clock, steps, now);
  return { index: settled.index, left: settled.left, paused: settled.paused, finished: settled.finished };
}
