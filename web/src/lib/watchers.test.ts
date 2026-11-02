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
  type ServerState = { version: string; configRevision: string };
  const current: ServerState = { version: '1.0.0', configRevision: 'aaa' };

  // sessionStorage n'existe pas sous Node : le garde-fou anti-boucle laisse alors toujours recharger.
  async function run(health: () => Promise<ServerState>) {
    const reload = vi.fn();
    const onReachable = vi.fn();
    const stop = watchVersion({
      api: { health } as unknown as Api,
      currentVersion: current.version,
      currentConfigRevision: current.configRevision,
      intervalMs: 1000,
      onReachable,
      reload,
    });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    return { reload, onReachable };
  }

  it('ne recharge pas si rien n’a changé', async () => {
    const { reload, onReachable } = await run(async () => current);
    expect(onReachable).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('recharge quand la version du serveur change', async () => {
    const { reload } = await run(async () => ({ ...current, version: '2.0.0' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('recharge quand la configuration change', async () => {
    const { reload } = await run(async () => ({ ...current, configRevision: 'bbb' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('signale un serveur injoignable sans recharger', async () => {
    const { reload, onReachable } = await run(async () => {
      throw new Error('réseau');
    });
    expect(onReachable).toHaveBeenCalledWith(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
