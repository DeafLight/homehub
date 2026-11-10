// Séance guidée de la tablette : déroulé seconde par seconde (échauffement, efforts, repos, pauses entre les tours) à
// partir de ce que le serveur donne pour la séance du jour, sans rien de personnel (ni notes, ni historique, ni tour
// de taille).
import { type Exercise, exerciseById, type FitnessFamily } from './fitness-catalogue.ts';
import { type FitnessState, nextSession, PALIERS, type Palier, planSession, ROUND_BREAK_SECONDS, type SessionNumber } from './fitness.ts';

/** Séance du jour vue par la tablette (GET /api/fitness/tablet). */
export type TabletSession = {
  ownerId: string;
  session: SessionNumber;
  palier: Palier;
  rounds: number;
  effort: number;
  rest: number;
  exercises: { family: FitnessFamily; id: string }[];
};

/** Séance du jour d'un programme, pour la tablette : numéro, rythme et exercices, rien d'autre. */
export function tabletSessionOf(ownerId: string, state: FitnessState): TabletSession {
  const session = nextSession(state);
  return {
    ownerId,
    session,
    palier: state.palier,
    rounds: PALIERS[state.palier].rounds,
    effort: state.effort,
    rest: state.rest,
    exercises: planSession(state, session).map(({ family, exercise }) => ({ family, id: exercise.id })),
  };
}

/** Échauffement : cinq mouvements doux d'une minute, pour monter en température sans s'essouffler. */
export const WARMUP: readonly { id: string; seconds: number; cue: string }[] = [
  { id: 'marche-sur-place', seconds: 60, cue: 'Tranquillement, en balançant les bras.' },
  { id: 'genoux-hauts-marche', seconds: 60, cue: 'Monte les genoux sans courir.' },
  { id: 'pas-chasses', seconds: 60, cue: 'Petits pas sur le côté, souples.' },
  { id: 'squat-chaise', seconds: 60, cue: 'Lentement, sans forcer.' },
  { id: 'fentes-arriere', seconds: 60, cue: 'Petite amplitude, une jambe puis l’autre.' },
];

export type WorkoutStep = {
  kind: 'warmup' | 'effort' | 'rest' | 'break';
  seconds: number;
  /** Exercice en cours (effort, échauffement) ou à venir (repos, pause). */
  exercise: Exercise;
  /** Tour (1…), 0 pendant l'échauffement. */
  round: number;
  /** Rang de l'exercice dans le tour (1…6) ou dans l'échauffement. */
  index: number;
  cue?: string;
};

/**
 * Déroulé complet. Après chaque effort, un repos qui montre l'exercice suivant ; à la fin d'un tour, le repos et la
 * pause entre les tours ne font qu'une étape. Rien après le dernier effort : la séance est finie.
 */
export function workoutSteps(plan: TabletSession): WorkoutStep[] {
  const steps: WorkoutStep[] = WARMUP.map((w, i) => ({ kind: 'warmup', seconds: w.seconds, exercise: exerciseById(w.id)!, round: 0, index: i + 1, cue: w.cue }));
  const exercises = plan.exercises.map((e) => exerciseById(e.id)).filter((e): e is Exercise => Boolean(e));
  for (let round = 1; round <= plan.rounds; round++) {
    exercises.forEach((exercise, i) => {
      steps.push({ kind: 'effort', seconds: plan.effort, exercise, round, index: i + 1 });
      const last = i === exercises.length - 1;
      if (last && round === plan.rounds) return;
      steps.push(
        last
          ? { kind: 'break', seconds: plan.rest + ROUND_BREAK_SECONDS, exercise: exercises[0], round: round + 1, index: 1 }
          : { kind: 'rest', seconds: plan.rest, exercise: exercises[i + 1], round, index: i + 2 },
      );
    });
  }
  return steps;
}

export const totalSeconds = (steps: WorkoutStep[]) => steps.reduce((sum, s) => sum + s.seconds, 0);
