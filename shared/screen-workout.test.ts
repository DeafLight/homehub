// Tests de l'horloge de la séance sur la télé : défilement des étapes, pause et reprise, étape suivante (aussi en
// pause), arrêt, fin naturelle, recalage local d'une vue reçue, et plan pour la télé sans rien de personnel.
import { describe, expect, it } from 'vitest';
import { emptyFitness } from './fitness.ts';
import { WARMUP, workoutSteps } from './fitness-workout.ts';
import { commandClock, positionAt, remainingMs, screenPlanOf, settleClock, startClock } from './screen-workout.ts';

const plan = {
  rounds: 1,
  effort: 30,
  rest: 20,
  exercises: [
    { family: 'jambes' as const, id: 'squat-chaise' },
    { family: 'gainage' as const, id: 'planche-genoux' },
  ],
};
const steps = workoutSteps(plan);
const T = 1_000_000;
const warmupMs = WARMUP.length * 60_000;

describe('horloge de la séance sur la télé', () => {
  it('fait défiler les étapes avec le temps, puis finit après la dernière', () => {
    const start = startClock(steps, T);
    expect(start).toMatchObject({ index: 0, left: 60_000, paused: false, finished: false });
    expect(settleClock(start, steps, T + 15_000)).toMatchObject({ index: 0, left: 45_000 });
    // Échauffement fini + 10 s : premier effort, 20 s restantes.
    expect(settleClock(start, steps, T + warmupMs + 10_000)).toMatchObject({ index: WARMUP.length, left: 20_000 });
    const total = steps.reduce((s, x) => s + x.seconds * 1000, 0);
    expect(settleClock(start, steps, T + total)).toMatchObject({ finished: true, stopped: false });
  });

  it('pause : le temps s’arrête ; reprise : il repart de là où il était', () => {
    let clock = commandClock(startClock(steps, T), steps, 'pause', T + 10_000);
    expect(clock).toMatchObject({ paused: true, left: 50_000 });
    expect(settleClock(clock, steps, T + 600_000)).toMatchObject({ index: 0, left: 50_000 });
    clock = commandClock(clock, steps, 'pause', T + 600_000);
    expect(clock).toMatchObject({ paused: false });
    expect(settleClock(clock, steps, T + 610_000)).toMatchObject({ index: 0, left: 40_000 });
  });

  it('suivant : étape suivante entière, en restant en pause ; après la dernière, finie', () => {
    let clock = commandClock(startClock(steps, T), steps, 'pause', T + 5_000);
    clock = commandClock(clock, steps, 'next', T + 6_000);
    expect(clock).toMatchObject({ index: 1, left: 60_000, paused: true });
    for (let i = 1; i < steps.length; i++) clock = commandClock(clock, steps, 'next', T + 7_000);
    expect(clock).toMatchObject({ finished: true, stopped: false });
    expect(commandClock(clock, steps, 'pause', T + 8_000)).toEqual(clock);
  });

  it('arrêter : finie et arrêtée, plus rien à prévoir', () => {
    const clock = commandClock(startClock(steps, T), steps, 'stop', T + 1_000);
    expect(clock).toMatchObject({ finished: true, stopped: true });
    expect(remainingMs(clock, steps)).toBe(0);
  });

  it('recale localement une vue reçue (télé, téléphone)', () => {
    expect(positionAt({ index: 0, left: 5_000, paused: false }, steps, T, T + 7_000)).toMatchObject({ index: 1, left: 58_000, finished: false });
    expect(positionAt({ index: 0, left: 5_000, paused: true }, steps, T, T + 7_000)).toMatchObject({ index: 0, left: 5_000 });
  });

  it('plan pour la télé : rythme et exercices seulement', () => {
    const p = screenPlanOf(emptyFitness(), 1);
    expect(Object.keys(p).sort()).toEqual(['effort', 'exercises', 'rest', 'rounds']);
    expect(p).toMatchObject({ rounds: 3, effort: 30, rest: 30 });
    expect(p.exercises).toHaveLength(6);
  });
});
