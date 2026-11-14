// Tests de la séance sur la télé côté front : jeton lu dans le fragment, libellés des étapes, minuteur recalé.
import { describe, expect, it } from 'vitest';
import { workoutSteps } from '../../../shared/fitness-workout.ts';
import { stepCue, stepLabel, timerFrom, tokenFromHash } from './tele-sport.ts';
import { tickWorkout } from './workout-timer.ts';

const plan = { rounds: 2, effort: 30, rest: 20, exercises: [{ family: 'jambes' as const, id: 'squat-chaise' }, { family: 'gainage' as const, id: 'planche-genoux' }] };
const steps = workoutSteps(plan);

describe('séance sur la télé (front)', () => {
  it('lit le jeton de la télé dans le fragment', () => {
    expect(tokenFromHash('#token=abc%2B1')).toBe('abc+1');
    expect(tokenFromHash('#autre=1')).toBeNull();
    expect(tokenFromHash('')).toBeNull();
  });

  it('libellés et consignes des étapes', () => {
    expect(stepLabel(steps[0], plan)).toBe('Échauffement · 1/5');
    expect(stepLabel(steps[5], plan)).toBe('Tour 1/2 · exercice 1/2');
    expect(stepLabel(steps[6], plan)).toBe('Repos');
    expect(stepLabel(steps[8], plan)).toBe('Pause avant le tour 2/2');
    expect(stepCue(steps[7])).toBe('Tiens la position.');
    expect(stepCue(steps[6])).toMatch(/Respire/u);
  });

  it('minuteur local recalé sur la position reçue, qui défile ensuite seul', () => {
    const timer = timerFrom({ index: 5, left: 3_500, paused: false }, 1_000);
    expect(timer).toMatchObject({ phase: 'running', index: 5, endsAt: 4_500, lastSecond: 4 });
    expect(tickWorkout(timer, steps, 2_000).cues).toEqual(['tick']);
    expect(tickWorkout(timer, steps, 4_500).timer.index).toBe(6);
  });
});
