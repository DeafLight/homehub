// « +1 min » / « −1 min » d'un minuteur qui sonne : compteur en attente, relance 5 s après le dernier toucher.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnoozer, secondsBeforeRelaunch, SNOOZE_DELAY_MS, SNOOZE_MAX_MINUTES } from './timer-snooze.ts';

describe('+1 min sur un minuteur qui sonne', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const commits: number[] = [];
    const snoozer = createSnoozer({ onCommit: (m) => commits.push(m), now: () => Date.now() });
    return { snoozer, commits };
  };

  it('chaque toucher repousse la relance : elle part 5 s après le dernier, avec le total', () => {
    const { snoozer, commits } = make();
    snoozer.add();
    expect(snoozer.state).toEqual({ minutes: 1, dueAt: SNOOZE_DELAY_MS });
    vi.advanceTimersByTime(4_000);
    snoozer.add();
    vi.advanceTimersByTime(4_000);
    snoozer.add();
    expect(commits).toEqual([]);
    expect(snoozer.state).toEqual({ minutes: 3, dueAt: 8_000 + SNOOZE_DELAY_MS });
    vi.advanceTimersByTime(SNOOZE_DELAY_MS - 1);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([3]);
    expect(snoozer.state).toEqual({ minutes: 0, dueAt: null });
  });

  it('« −1 min » corrige et repousse aussi ; revenu à 0, rien ne repart', () => {
    const { snoozer, commits } = make();
    snoozer.add();
    snoozer.add();
    vi.advanceTimersByTime(4_000);
    snoozer.remove();
    expect(snoozer.state).toEqual({ minutes: 1, dueAt: 4_000 + SNOOZE_DELAY_MS });
    vi.advanceTimersByTime(4_000);
    expect(commits).toEqual([]);
    snoozer.remove();
    snoozer.remove(); // jamais sous 0
    expect(snoozer.state).toEqual({ minutes: 0, dueAt: null });
    vi.advanceTimersByTime(60_000);
    expect(commits).toEqual([]);
  });

  it('« Arrêter » oublie ce qui attend ; une heure au plus', () => {
    const { snoozer, commits } = make();
    for (let i = 0; i < SNOOZE_MAX_MINUTES + 5; i++) snoozer.add();
    expect(snoozer.state.minutes).toBe(SNOOZE_MAX_MINUTES);
    snoozer.cancel();
    vi.advanceTimersByTime(60_000);
    expect(commits).toEqual([]);
  });

  it('prévient à chaque changement', () => {
    const changes: number[] = [];
    const snoozer = createSnoozer({ onCommit: () => {}, onChange: (s) => changes.push(s.minutes) });
    snoozer.add();
    snoozer.add();
    snoozer.remove();
    vi.advanceTimersByTime(SNOOZE_DELAY_MS);
    expect(changes).toEqual([1, 2, 1, 0]);
  });

  it('secondes avant la relance', () => {
    expect(secondsBeforeRelaunch({ minutes: 0, dueAt: null }, 0)).toBe(0);
    expect(secondsBeforeRelaunch({ minutes: 2, dueAt: 5_000 }, 0)).toBe(5);
    expect(secondsBeforeRelaunch({ minutes: 2, dueAt: 5_000 }, 1_200)).toBe(4);
    expect(secondsBeforeRelaunch({ minutes: 2, dueAt: 5_000 }, 9_000)).toBe(0);
  });
});
