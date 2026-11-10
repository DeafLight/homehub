// Minuteur de la séance guidée (tablette), en fonctions pures : chaque action prend l'état, les étapes et l'heure
// (horloge injectée) et rend le nouvel état avec les bips à jouer. Le composant Workout ne fait qu'appeler ces
// fonctions, jouer les bips et afficher ; tout le déroulé (pause, passer, arrêter, fin des étapes) se teste ici.
import { totalSeconds, type WorkoutStep } from '../../../shared/fitness-workout.ts';

/** Bips de la séance (voir `cue` dans beep.ts) ; `side` : à la moitié d'un effort d'un côté puis de l'autre. */
export type WorkoutCue = 'go' | 'rest' | 'tick' | 'side';

/** Le message « Change de côté » reste en grand ces secondes-là après la mi-temps. */
export const SIDE_SWITCH_SECONDS = 3;

/** Effort d'un exercice fait d'un côté puis de l'autre : on change de côté à sa moitié. */
const hasSides = (step: WorkoutStep | undefined) => step?.kind === 'effort' && Boolean(step.exercise.sides);

/** running : une étape défile ; done : séance finie ou arrêtée, en attente de la note ; saved : note envoyée. */
export type WorkoutPhase = 'running' | 'done' | 'saved';

export type WorkoutTimer = {
  phase: WorkoutPhase;
  /** Étape en cours. */
  index: number;
  /** Heure (ms) de fin de l'étape en cours ; périmée pendant la pause (la reprise la recalcule). */
  endsAt: number;
  /** Millisecondes restantes de l'étape en cours. */
  left: number;
  paused: boolean;
  /** Séance arrêtée avant la fin. */
  stopped: boolean;
  /** Dernière seconde affichée, pour ne biper qu'une fois par seconde. */
  lastSecond: number;
};

export type Transition = { timer: WorkoutTimer; cues: WorkoutCue[] };

function enter(timer: WorkoutTimer, steps: WorkoutStep[], index: number, now: number): WorkoutTimer {
  const ms = steps[index].seconds * 1000;
  return { ...timer, index, endsAt: now + ms, left: ms, lastSecond: steps[index].seconds };
}

/** Début de la séance : première étape, bip de départ. */
export function startWorkout(steps: WorkoutStep[], now: number): Transition {
  const idle: WorkoutTimer = { phase: 'running', index: 0, endsAt: now, left: 0, paused: false, stopped: false, lastSecond: 0 };
  if (!steps.length) return { timer: { ...idle, phase: 'done' }, cues: [] };
  return { timer: enter(idle, steps, 0, now), cues: ['go'] };
}

/**
 * Étape suivante (fin du compte à rebours ou bouton Passer). Bip de départ en arrivant sur un effort ou d'un
 * échauffement au suivant, bip de repos en quittant un effort ; après la dernière étape, la séance est finie.
 */
export function skipStep(timer: WorkoutTimer, steps: WorkoutStep[], now: number): Transition {
  if (timer.phase !== 'running') return { timer, cues: [] };
  const from = steps[timer.index];
  if (timer.index + 1 >= steps.length) return { timer: { ...timer, phase: 'done', paused: false, left: 0 }, cues: ['rest'] };
  // Passer pendant la pause : on reste en pause, au début de l'étape suivante.
  const next = enter(timer, steps, timer.index + 1, now);
  const to = steps[next.index];
  const cues: WorkoutCue[] = to.kind === 'effort' || (to.kind === 'warmup' && from.kind === 'warmup') ? ['go'] : from.kind === 'effort' ? ['rest'] : [];
  return { timer: next, cues };
}

/**
 * Battement de l'horloge : met à jour le temps restant, bipe à la mi-temps d'un effort d'un côté puis de l'autre et
 * sur les trois dernières secondes, passe à la suite.
 */
export function tickWorkout(timer: WorkoutTimer, steps: WorkoutStep[], now: number): Transition {
  if (timer.phase !== 'running' || timer.paused || !steps.length) return { timer, cues: [] };
  const left = Math.max(0, timer.endsAt - now);
  const second = Math.ceil(left / 1000);
  const cues: WorkoutCue[] = [];
  const step = steps[timer.index];
  const half = (step.seconds * 1000) / 2;
  if (hasSides(step) && timer.left > half && left <= half && left > 0) cues.push('side');
  const next = { ...timer, left };
  if (second !== timer.lastSecond) {
    next.lastSecond = second;
    if (second > 0 && second <= 3) cues.push('tick');
  }
  if (left > 0) return { timer: next, cues };
  const after = skipStep(next, steps, now);
  return { timer: after.timer, cues: [...cues, ...after.cues] };
}

/** Pause ou reprise : à la reprise, le temps restant repart de là où il s'était arrêté. */
export function togglePause(timer: WorkoutTimer, now: number): WorkoutTimer {
  if (timer.phase !== 'running') return timer;
  return timer.paused ? { ...timer, paused: false, endsAt: now + timer.left } : { ...timer, paused: true };
}

/** Bouton Arrêter : la séance s'achève tout de suite, notée comme arrêtée. */
export function stopWorkout(timer: WorkoutTimer): WorkoutTimer {
  if (timer.phase !== 'running') return timer;
  return { ...timer, phase: 'done', stopped: true, paused: false };
}

/** La note est enregistrée. */
export function markSaved(timer: WorkoutTimer): WorkoutTimer {
  return timer.phase === 'done' ? { ...timer, phase: 'saved' } : timer;
}

/** Ce que l'écran affiche : secondes, avancement de l'étape et de la séance, temps restant. */
export function workoutView(timer: WorkoutTimer, steps: WorkoutStep[]) {
  const step = steps[timer.index] as WorkoutStep | undefined;
  const seconds = Math.ceil(timer.left / 1000);
  const remaining = steps.slice(timer.index + 1).reduce((sum, s) => sum + s.seconds, 0) + seconds;
  const half = step ? (step.seconds * 1000) / 2 : 0;
  const side: 1 | 2 | null = hasSides(step) ? (timer.left > half ? 1 : 2) : null;
  return {
    step,
    seconds,
    /** Côté en cours d'un effort fait d'un côté puis de l'autre (1, puis 2 après la mi-temps), sinon null. */
    side,
    /** Juste après la mi-temps : « Change de côté » en grand. */
    switching: side === 2 && timer.left > half - SIDE_SWITCH_SECONDS * 1000,
    /** Part écoulée de l'étape (0 → 1). */
    progress: step ? 1 - timer.left / (step.seconds * 1000) : 0,
    /** Secondes restantes de toute la séance. */
    remaining,
    /** Part écoulée de la séance (0 → 1). */
    done: steps.length ? 1 - remaining / totalSeconds(steps) : 0,
  };
}
