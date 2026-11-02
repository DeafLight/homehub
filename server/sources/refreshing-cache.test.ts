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
});
