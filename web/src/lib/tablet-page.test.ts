// Tests du signalement du chargement de la page de la tablette : envoyé une fois, réessayé avec la même heure tant
// que le serveur ne répond pas, abandonné après le dernier essai ou à l'arrêt.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportTabletPage } from './tablet-page.ts';

const loadedAt = new Date(2026, 10, 20, 3, 2).getTime();
const page = { loadedAt: new Date(loadedAt).toISOString(), nightly: true };

describe('reportTabletPage', () => {
  afterEach(() => vi.useRealTimers());

  it('envoyé une fois quand le serveur répond', async () => {
    const send = vi.fn(async () => page);
    reportTabletPage({ send, loadedAt, nightly: true });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(page);
  });

  it('serveur absent (nouvelle version qui démarre) : réessai avec la même heure, puis abandon', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_page: typeof page): Promise<unknown> => {
      throw new Error('hors ligne');
    });
    reportTabletPage({ send, loadedAt, nightly: true, retryMs: 1000, attempts: 3 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.every(([p]) => p.loadedAt === page.loadedAt)).toBe(true);
  });

  it('arrêté : plus de réessai', async () => {
    vi.useFakeTimers();
    let fail = true;
    const send = vi.fn(async () => {
      if (fail) throw new Error('hors ligne');
      return page;
    });
    const stop = reportTabletPage({ send, loadedAt, nightly: false, retryMs: 1000 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(send).toHaveBeenCalledTimes(2);
    stop();
    fail = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
