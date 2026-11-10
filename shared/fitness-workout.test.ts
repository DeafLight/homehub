import { describe, expect, it } from 'vitest';
import { MOVES } from './fitness-moves.ts';
import { emptyFitness, planSession, sessionSeconds } from './fitness.ts';
import { type TabletSession, totalSeconds, WARMUP, workoutSteps } from './fitness-workout.ts';

const plan: TabletSession = {
  ownerId: 'alex',
  session: 1,
  palier: 1,
  rounds: 3,
  effort: 30,
  rest: 20,
  exercises: planSession(emptyFitness(), 1).map(({ family, exercise }) => ({ family, id: exercise.id })),
};

describe('séance guidée', () => {
  it('échauffement de 5 minutes, avec des exercices animés', () => {
    expect(WARMUP.reduce((s, w) => s + w.seconds, 0)).toBe(300);
    for (const w of WARMUP) expect(MOVES[w.id]).toBeDefined();
  });

  it('effort, puis repos qui montre l’exercice suivant ; pause entre les tours ; rien après le dernier effort', () => {
    const steps = workoutSteps(plan).slice(WARMUP.length);
    expect(steps[0]).toMatchObject({ kind: 'effort', seconds: 30, round: 1, index: 1, exercise: { id: plan.exercises[0].id } });
    expect(steps[1]).toMatchObject({ kind: 'rest', seconds: 20, round: 1, index: 2, exercise: { id: plan.exercises[1].id } });
    expect(steps[11]).toMatchObject({ kind: 'break', seconds: 80, round: 2, index: 1, exercise: { id: plan.exercises[0].id } });
    expect(steps.filter((s) => s.kind === 'effort')).toHaveLength(18);
    expect(steps.at(-1)).toMatchObject({ kind: 'effort', round: 3, index: 6 });
  });

  it('dure l’échauffement plus la séance annoncée, moins le dernier repos', () => {
    expect(totalSeconds(workoutSteps(plan))).toBe(300 + sessionSeconds({ palier: 1, effort: 30, rest: 20 }) - 20);
  });
});
