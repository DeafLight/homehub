// Tests de l'écoute des vidéos par la tablette (première demande sans rejouer, vidéos suivantes, nouvel essai après
// une erreur, arrêt) et du rechargement de version différé pendant une vidéo.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TabletVideo, TabletVideoReply } from '../../../shared/video.ts';
import type { Api } from './api.ts';
import { listenTabletVideo } from './video-dock.ts';
import { watchVersion } from './version.ts';

const VIDEO: TabletVideo = { videoId: 'dQw4w9WgXcQ', start: 0, from: 'Léa', seq: 1 };

afterEach(() => vi.useRealTimers());

describe('listenTabletVideo', () => {
  it('écoute, passe chaque vidéo, réessaie après une erreur, s’arrête', async () => {
    vi.useFakeTimers();
    const calls: (number | null)[] = [];
    const replies: (TabletVideoReply | Error)[] = [{ video: null, last: 4 }, new Error('réseau'), { video: { ...VIDEO, seq: 5 }, last: 5 }];
    let stop = () => {};
    const api = {
      tabletVideo: async (after: number | null) => {
        calls.push(after);
        const next = replies.shift();
        if (!next) {
          stop();
          throw new Error('arrêtée');
        }
        if (next instanceof Error) throw next;
        return next;
      },
    };
    const seen: TabletVideo[] = [];
    stop = listenTabletVideo({ api, onVideo: (v) => seen.push(v), retryMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([null, 4]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([null, 4, 4, 5]);
    expect(seen).toEqual([{ ...VIDEO, seq: 5 }]);
  });
});

describe('watchVersion', () => {
  it('diffère le rechargement pendant une vidéo', async () => {
    vi.useFakeTimers();
    let playing = true;
    const reload = vi.fn();
    const api = { health: async () => ({ version: '2.0.0', configRevision: 'r1', time: '' }) } as unknown as Api;
    const stop = watchVersion({ api, currentVersion: '1.0.0', currentConfigRevision: 'r1', intervalMs: 1000, onReachable: () => {}, deferred: () => playing, reload });
    await vi.advanceTimersByTimeAsync(2500);
    expect(reload).not.toHaveBeenCalled();
    playing = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });
});
