import { describe, expect, it } from 'vitest';
import { NOW, silentLogger } from '../testing.ts';
import { createRefreshingCache } from './refreshing-cache.ts';

describe('createRefreshingCache', () => {
  it('attend retryDelayMs avant de retenter après un échec', async () => {
    let now = NOW;
    let calls = 0;
    const cache = createRefreshingCache<string>({
      clock: () => now,
      logger: silentLogger(),
      staleMaxMs: 3_600_000,
      retryDelayMs: 60_000,
      async load() {
        calls++;
        if (calls === 1) throw new Error('panne');
        return 'ok';
      },
    });

    await expect(cache.get('k', 600_000, 'Test')).rejects.toThrow('panne');
    await expect(cache.get('k', 600_000, 'Test')).rejects.toThrow('panne');
    expect(calls).toBe(1);

    now = new Date(NOW.getTime() + 61_000);
    expect(await cache.get('k', 600_000, 'Test')).toBe('ok');
    expect(calls).toBe(2);
  });

  /** Cache dont chaque chargement attend qu'on le résolve (ou le rejette) à la main. */
  function manual() {
    let now = NOW;
    const pending: Array<{ resolve(v: string): void; reject(e: Error): void }> = [];
    const logger = silentLogger();
    const cache = createRefreshingCache<string>({
      clock: () => now,
      logger,
      staleMaxMs: 3_600_000,
      retryDelayMs: 60_000,
      load: () => new Promise<string>((resolve, reject) => pending.push({ resolve, reject })),
    });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return { cache, pending, logger, tick, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
  }

  it('sert l’ancienne valeur sans attendre et la remplace une fois rechargée en arrière-plan', async () => {
    const { cache, pending, tick, advance } = manual();
    const first = cache.get('k', 600_000, 'Test');
    pending[0].resolve('v1');
    expect(await first).toBe('v1');

    advance(601_000);
    expect(await cache.get('k', 600_000, 'Test')).toBe('v1'); // le rechargement ne répond pas encore
    expect(await cache.get('k', 600_000, 'Test')).toBe('v1');
    expect(pending).toHaveLength(2); // une seule requête de rechargement
    pending[1].resolve('v2');
    await tick();
    expect(await cache.get('k', 600_000, 'Test')).toBe('v2');
  });

  it('garde l’ancienne valeur si le rechargement en arrière-plan échoue, et le signale', async () => {
    const { cache, pending, logger, tick, advance } = manual();
    const first = cache.get('k', 600_000, 'Test');
    pending[0].resolve('v1');
    await first;

    advance(601_000);
    expect(await cache.get('k', 600_000, 'Test')).toBe('v1');
    pending[1].reject(new Error('panne'));
    await tick();
    expect(logger.errors).toEqual(['Test : panne ; données précédentes conservées.']);
    expect(await cache.get('k', 600_000, 'Test')).toBe('v1');
    expect(pending).toHaveLength(2); // pas de nouvel essai avant retryDelayMs
  });

  it('attend le chargement quand l’ancienne valeur est trop vieille pour être servie', async () => {
    const { cache, pending, advance } = manual();
    const first = cache.get('k', 600_000, 'Test');
    pending[0].resolve('v1');
    await first;

    advance(3_601_000);
    const second = cache.get('k', 600_000, 'Test');
    pending[1].reject(new Error('panne'));
    await expect(second).rejects.toThrow('panne');
  });
});

