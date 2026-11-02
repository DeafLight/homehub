import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from './api.ts';
import { watchIdle } from './idle.ts';
import { watchVersion } from './version.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('watchIdle', () => {
  it('se déclenche après le délai, repoussé par chaque interaction', () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    const stop = watchIdle(1000, onIdle, target);

    vi.advanceTimersByTime(900);
    target.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(900);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onIdle).toHaveBeenCalledOnce();
    stop();
  });

  it("ne se déclenche plus après l'arrêt", () => {
    const onIdle = vi.fn();
    watchIdle(1000, onIdle, new EventTarget())();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});

describe('watchVersion', () => {
  const apiReturning = (health: () => Promise<{ version: string }>) => ({ health }) as unknown as Api;

  it('recharge quand la version du serveur change', async () => {
    const reload = vi.fn();
    const onReachable = vi.fn();
    const stop = watchVersion({ api: apiReturning(async () => ({ version: '2.0.0' })), currentVersion: '1.0.0', intervalMs: 1000, onReachable, reload });
    await vi.advanceTimersByTimeAsync(0);
    expect(onReachable).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledOnce();
    stop();
  });

  it('signale un serveur injoignable sans recharger', async () => {
    const reload = vi.fn();
    const onReachable = vi.fn();
    const stop = watchVersion({ api: apiReturning(async () => { throw new Error('réseau'); }), currentVersion: '1.0.0', intervalMs: 1000, onReachable, reload });
    await vi.advanceTimersByTimeAsync(0);
    expect(onReachable).toHaveBeenCalledWith(false);
    expect(reload).not.toHaveBeenCalled();
    stop();
  });
});
