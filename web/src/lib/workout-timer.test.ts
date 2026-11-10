// Tests du minuteur de la séance guidée : horloge injectée, pause et reprise, passer, arrêter, fin des étapes, bips,
// changement de côté à mi-effort.
import { describe, expect, it } from 'vitest';
import { exerciseById } from '../../../shared/fitness-catalogue.ts';
import { WARMUP, type WorkoutStep } from '../../../shared/fitness-workout.ts';
import { markSaved, skipStep, startWorkout, stopWorkout, tickWorkout, togglePause, type WorkoutCue, type WorkoutTimer, workoutView } from './workout-timer.ts';

const move = exerciseById(WARMUP[0].id)!;
const steps: WorkoutStep[] = [
  { kind: 'warmup', seconds: 10, exercise: move, round: 0, index: 1 },
  { kind: 'warmup', seconds: 10, exercise: move, round: 0, index: 2 },
  { kind: 'effort', seconds: 30, exercise: move, round: 1, index: 1 },
  { kind: 'rest', seconds: 20, exercise: move, round: 1, index: 2 },
  { kind: 'effort', seconds: 30, exercise: move, round: 1, index: 2 },
];

/** Fait battre l'horloge toutes les 200 ms de `from` à `to`, en cumulant les bips. */
function run(timer: WorkoutTimer, from: number, to: number) {
  const cues: WorkoutCue[] = [];
  for (let t = from; t <= to; t += 200) {
    const r = tickWorkout(timer, steps, t);
    timer = r.timer;
    cues.push(...r.cues);
  }
  return { timer, cues };
}

const sided = exerciseById('fentes-arriere')!;
const sidedSteps: WorkoutStep[] = [
  { kind: 'effort', seconds: 30, exercise: sided, round: 1, index: 1 },
  { kind: 'rest', seconds: 20, exercise: move, round: 1, index: 2 },
  { kind: 'effort', seconds: 30, exercise: move, round: 1, index: 2 },
];

describe('minuteur de séance', () => {
  it('exercice d’un côté puis de l’autre : bip distinct à la mi-temps, et « change de côté » quelques secondes', () => {
    let timer = startWorkout(sidedSteps, 0).timer;
    expect(workoutView(timer, sidedSteps)).toMatchObject({ side: 1, switching: false });
    const cues: WorkoutCue[] = [];
    for (let t = 0; t <= 14_800; t += 200) {
      const r = tickWorkout(timer, sidedSteps, t);
      timer = r.timer;
      cues.push(...r.cues);
    }
    expect(cues).toEqual([]);
    const half = tickWorkout(timer, sidedSteps, 15_000);
    expect(half.cues).toEqual(['side']);
    timer = half.timer;
    expect(workoutView(timer, sidedSteps)).toMatchObject({ side: 2, switching: true });
    // Une seule fois, et le message en grand s'efface après trois secondes.
    const after = tickWorkout(timer, sidedSteps, 15_200);
    expect(after.cues).toEqual([]);
    expect(workoutView(tickWorkout(after.timer, sidedSteps, 18_200).timer, sidedSteps)).toMatchObject({ side: 2, switching: false });
  });

  it('pas de bip de côté pour un exercice des deux côtés à la fois, ni pendant le repos', () => {
    let timer = startWorkout(sidedSteps, 0).timer;
    timer = skipStep(timer, sidedSteps, 0).timer; // repos
    expect(workoutView(timer, sidedSteps).side).toBeNull();
    const cues: WorkoutCue[] = [];
    for (let t = 0; t <= 50_000; t += 200) {
      const r = tickWorkout(timer, sidedSteps, t);
      timer = r.timer;
      cues.push(...r.cues);
    }
    expect(cues).not.toContain('side');
  });

  it('pause juste avant la mi-temps : le bip vient à la reprise, au bon moment', () => {
    let timer = startWorkout(sidedSteps, 0).timer;
    timer = tickWorkout(timer, sidedSteps, 14_000).timer;
    timer = togglePause(timer, 14_000);
    expect(tickWorkout(timer, sidedSteps, 40_000).cues).toEqual([]);
    timer = togglePause(timer, 40_000);
    expect(tickWorkout(timer, sidedSteps, 40_800).cues).toEqual([]);
    expect(tickWorkout(timer, sidedSteps, 41_000).cues).toEqual(['side']);
  });

  it('démarre sur la première étape avec un bip de départ', () => {
    const { timer, cues } = startWorkout(steps, 1000);
    expect(timer).toMatchObject({ phase: 'running', index: 0, left: 10_000, endsAt: 11_000, paused: false });
    expect(cues).toEqual(['go']);
    expect(workoutView(timer, steps)).toMatchObject({ seconds: 10, progress: 0, remaining: 100, done: 0 });
  });

  it('sans étape, la séance est finie tout de suite', () => {
    expect(startWorkout([], 0).timer.phase).toBe('done');
  });

  it('compte à rebours : bips sur les trois dernières secondes, puis étape suivante', () => {
    const start = startWorkout(steps, 0).timer;
    const { timer, cues } = run(start, 0, 10_000);
    expect(cues).toEqual(['tick', 'tick', 'tick', 'go']); // échauffement → échauffement : départ
    expect(timer).toMatchObject({ index: 1, left: 10_000, endsAt: 20_000 });
  });

  it('avancement de l’étape et de la séance', () => {
    const { timer } = run(startWorkout(steps, 0).timer, 0, 5000);
    expect(workoutView(timer, steps)).toMatchObject({ seconds: 5, progress: 0.5, remaining: 95 });
  });

  it('bip de repos en quittant un effort, de départ en arrivant sur un effort', () => {
    let timer = startWorkout(steps, 0).timer;
    timer = skipStep(timer, steps, 0).timer; // échauffement 2
    const toEffort = skipStep(timer, steps, 0);
    expect(toEffort.cues).toEqual(['go']);
    const toRest = skipStep(toEffort.timer, steps, 0);
    expect(toRest.cues).toEqual(['rest']);
    expect(toRest.timer.index).toBe(3);
  });

  it('pause : le temps ne s’écoule plus, et repart d’où il en était à la reprise', () => {
    let { timer } = run(startWorkout(steps, 0).timer, 0, 4000);
    timer = togglePause(timer, 4000);
    timer = run(timer, 4000, 60_000).timer;
    expect(timer).toMatchObject({ paused: true, index: 0, left: 6000 });
    timer = togglePause(timer, 60_000);
    expect(timer).toMatchObject({ paused: false, endsAt: 66_000 });
    timer = run(timer, 60_000, 65_800).timer;
    expect(timer.index).toBe(0);
    timer = tickWorkout(timer, steps, 66_000).timer;
    expect(timer.index).toBe(1);
  });

  it('passer pendant la pause : reste en pause, au début de l’étape suivante', () => {
    let timer = togglePause(startWorkout(steps, 0).timer, 2000);
    timer = skipStep(timer, steps, 3000).timer;
    expect(timer).toMatchObject({ paused: true, index: 1, left: 10_000 });
    timer = togglePause(timer, 9000);
    expect(timer.endsAt).toBe(19_000);
  });

  it('fin des étapes : séance terminée (pas arrêtée), bip de repos, l’horloge ne fait plus rien', () => {
    let timer = startWorkout(steps, 0).timer;
    for (let i = 0; i < steps.length - 1; i++) timer = skipStep(timer, steps, 0).timer;
    const end = skipStep(timer, steps, 0);
    expect(end.timer).toMatchObject({ phase: 'done', stopped: false });
    expect(end.cues).toEqual(['rest']);
    expect(tickWorkout(end.timer, steps, 999_999)).toEqual({ timer: end.timer, cues: [] });
    expect(skipStep(end.timer, steps, 0).cues).toEqual([]);
  });

  it('la dernière étape qui s’écoule termine la séance', () => {
    let timer = startWorkout(steps, 0).timer;
    for (let i = 0; i < steps.length - 1; i++) timer = skipStep(timer, steps, 0).timer;
    const { timer: end, cues } = run(timer, 0, 30_000);
    expect(end.phase).toBe('done');
    expect(cues).toEqual(['tick', 'tick', 'tick', 'rest']);
  });

  it('arrêter : séance finie et notée comme arrêtée, même en pause', () => {
    const paused = togglePause(startWorkout(steps, 0).timer, 1000);
    const stopped = stopWorkout(paused);
    expect(stopped).toMatchObject({ phase: 'done', stopped: true, paused: false });
    expect(togglePause(stopped, 2000)).toBe(stopped);
  });

  it('enregistrée seulement une fois finie', () => {
    const running = startWorkout(steps, 0).timer;
    expect(markSaved(running)).toBe(running);
    expect(markSaved(stopWorkout(running)).phase).toBe('saved');
  });
});
