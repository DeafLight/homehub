// Tests de l'attente de fin de frappe : un seul lancement après la dernière frappe, rien après `cancel`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncer } from './debounce.ts';

describe('attente de fin de frappe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lance une seule fois, après la dernière frappe', () => {
    const run = vi.fn();
    const search = createDebouncer(400).wrap(run);
    search();
    vi.advanceTimersByTime(300);
    search();
    vi.advanceTimersByTime(300);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('chaque fonction attend de son côté', () => {
    const a = vi.fn();
    const b = vi.fn();
    const debouncer = createDebouncer(400);
    const runA = debouncer.wrap(a);
    const runB = debouncer.wrap(b);
    runA();
    runB();
    vi.advanceTimersByTime(400);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('plus rien après cancel', () => {
    const run = vi.fn();
    const debouncer = createDebouncer(400);
    debouncer.wrap(run)();
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });
});
