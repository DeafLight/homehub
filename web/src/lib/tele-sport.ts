// Séance de sport sur la télé (fonction 12), côté front : jeton de la télé lu dans l'adresse de la page, libellé d'une
// étape, minuteur local recalé sur la position envoyée par le serveur. Partagé par la page de la télé
// (tele/TeleSport.svelte) et la carte de pilotage du téléphone (fitness/TvWorkoutCard.svelte).
import { WARMUP, type WorkoutStep } from '../../../shared/fitness-workout.ts';
import type { ScreenWorkoutPlan, WorkoutPosition } from '../../../shared/screen-workout.ts';
import type { WorkoutTimer } from './workout-timer.ts';

/** Jeton de la télé dans le fragment de l'adresse (`#token=…`, jamais envoyé au serveur dans l'adresse). */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/u, '')).get('token');
  return token?.trim() || null;
}

/** « Échauffement · 2/5 », « Tour 1/3 · exercice 4/6 », « Pause avant le tour 2/3 », « Repos ». */
export function stepLabel(step: WorkoutStep, plan: ScreenWorkoutPlan): string {
  if (step.kind === 'warmup') return `Échauffement · ${step.index}/${WARMUP.length}`;
  if (step.kind === 'effort') return `Tour ${step.round}/${plan.rounds} · exercice ${step.index}/${plan.exercises.length}`;
  if (step.kind === 'break') return `Pause avant le tour ${step.round}/${plan.rounds}`;
  return 'Repos';
}

/**
 * Minuteur local (lib/workout-timer.ts) à partir de la position reçue à l'heure `now` : il défile ensuite seul, bips
 * compris, jusqu'à la prochaine nouvelle du serveur.
 */
export function timerFrom(position: WorkoutPosition, now: number): WorkoutTimer {
  return {
    phase: 'running',
    index: position.index,
    endsAt: now + position.left,
    left: position.left,
    paused: position.paused,
    stopped: false,
    lastSecond: Math.ceil(position.left / 1000),
  };
}

/** Consigne affichée sous le nom de l'exercice. */
export function stepCue(step: WorkoutStep): string {
  if (step.cue) return step.cue;
  if (step.kind === 'effort') return step.exercise.unit === 's' ? 'Tiens la position.' : 'À ton rythme, mouvement propre.';
  return 'Respire, bois un peu, mets-toi en place.';
}
