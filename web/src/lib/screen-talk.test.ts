// Tests de « Parler en direct à la télé » côté téléphone : réduction à 16 kHz sans couture entre morceaux, PCM
// petit-boutiste, puis la prise de parole (micro avant la télé, envois groupés pendant qu'un envoi est en route,
// fin par le parent, par le serveur ou sur une erreur d'ouverture).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api.ts';
import { createDownsampler, createScreenTalker, joinPcm, type TalkApi, type TalkState } from './screen-talk.ts';

describe('createDownsampler', () => {
  it('48 kHz → 16 kHz : un échantillon sur trois, moyenne des trois', () => {
    const down = createDownsampler(48_000, 16_000);
    expect([...down(Float32Array.from([0.3, 0.3, 0.3, -1, -1, -1]))]).toEqual([Math.round(0.3 * 0x7fff), -0x8000]);
  });

  it('les morceaux se suivent sans couture (le reste d’un morceau compte dans le suivant)', () => {
    const whole = createDownsampler(44_100, 16_000);
    const split = createDownsampler(44_100, 16_000);
    const input = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 7));
    const expected = [...whole(input)];
    const parts = [input.subarray(0, 1000), input.subarray(1000, 1001), input.subarray(1001, 3333), input.subarray(3333)];
    expect(parts.flatMap((p) => [...split(p)])).toEqual(expected);
    expect(expected.length).toBe(1600);
  });

  it('écrête au-delà de ±1', () => {
    expect([...createDownsampler(16_000, 16_000)(Float32Array.from([2, -2]))]).toEqual([0x7fff, -0x8000]);
  });
});

describe('joinPcm', () => {
  it('colle les morceaux en octets petit-boutistes', () => {
    expect([...joinPcm([Int16Array.from([1, -2]), Int16Array.from([0x1234])])]).toEqual([1, 0, 0xfe, 0xff, 0x34, 0x12]);
  });
});

describe('createScreenTalker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness({ startError = null as Error | null, micError = null as Error | null } = {}) {
    const states: TalkState[] = [];
    const sent: { seq: number; bytes: number }[] = [];
    let release: (() => void) | null = null;
    let sendError: Error | null = null;
    let feed: (s: Float32Array) => void = () => {};
    const mic = { rate: 16_000, stop: vi.fn() };
    const api = {
      startScreenTalk: vi.fn(async () => {
        if (startError) throw startError;
        return { id: 't1', device: 'Télé du salon', rate: 16_000, maxSeconds: 600 };
      }),
      sendScreenTalk: vi.fn(async (_id: string, _talk: string, seq: number, pcm: Uint8Array) => {
        sent.push({ seq, bytes: pcm.byteLength });
        if (sendError) throw sendError;
        // Le premier envoi reste en route jusqu'à `release` : la suite attend.
        if (seq === 1) await new Promise<void>((r) => (release = r));
      }),
      stopScreenTalk: vi.fn(async () => {}),
    } satisfies TalkApi;
    const talker = createScreenTalker({
      api,
      onState: (s) => states.push(s),
      chunkMs: 250,
      capture: async (onSamples) => {
        if (micError) throw micError;
        feed = onSamples;
        return mic;
      },
    });
    return {
      talker, api, states, sent, mic,
      feed: (n: number) => feed(new Float32Array(n)),
      release: () => release?.(),
      failSends: (err: Error) => (sendError = err),
    };
  }

  it('micro puis télé ; un morceau tous les 250 ms, la suite groupée pendant un envoi en route ; arrêt', async () => {
    const h = harness();
    await h.talker.start('tv1');
    expect(h.states).toEqual([{ phase: 'starting', screen: 'tv1' }, { phase: 'live', screen: 'tv1', device: 'Télé du salon' }]);
    h.feed(100);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toEqual([{ seq: 1, bytes: 200 }]);
    h.feed(100);
    await vi.advanceTimersByTimeAsync(250);
    h.feed(50);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toHaveLength(1);
    h.release();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toEqual([{ seq: 1, bytes: 200 }, { seq: 2, bytes: 300 }]);

    h.talker.stop();
    expect(h.mic.stop).toHaveBeenCalled();
    expect(h.api.stopScreenTalk).toHaveBeenCalledWith('tv1', 't1');
    expect(h.states.at(-1)).toEqual({ phase: 'idle' });
  });

  it('le serveur dit que c’est fini (410) : la prise s’arrête avec la raison, sans rappeler le serveur', async () => {
    const h = harness();
    await h.talker.start('tv1');
    h.release();
    h.failSends(new ApiError(410, 'La télé a arrêté d’écouter'));
    h.feed(10);
    await vi.advanceTimersByTimeAsync(250);
    h.feed(10);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.states.at(-1)).toEqual({ phase: 'ended', message: 'La télé a arrêté d’écouter' });
    expect(h.mic.stop).toHaveBeenCalled();
    expect(h.api.stopScreenTalk).not.toHaveBeenCalled();
  });

  it('une erreur réseau passagère ne coupe pas : la suite repart au tour suivant', async () => {
    const h = harness();
    await h.talker.start('tv1');
    h.feed(10);
    await vi.advanceTimersByTimeAsync(250);
    h.release();
    h.failSends(new Error('Failed to fetch'));
    h.feed(10);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.states.at(-1)?.phase).toBe('live');
  });

  it('micro refusé, ou télé qui ne peut pas : erreur, rien n’est laissé ouvert', async () => {
    const denied = harness({ micError: Object.assign(new Error('non'), { name: 'NotAllowedError' }) });
    await denied.talker.start('tv1');
    expect(denied.states.at(-1)).toEqual({ phase: 'error', message: 'Micro refusé : autorise-le pour HomeHub dans le navigateur.' });
    expect(denied.api.startScreenTalk).not.toHaveBeenCalled();

    const busy = harness({ startError: new ApiError(409, 'Sam parle déjà à Télé du salon') });
    await busy.talker.start('tv1');
    expect(busy.states.at(-1)).toEqual({ phase: 'error', message: 'Sam parle déjà à Télé du salon' });
    expect(busy.mic.stop).toHaveBeenCalled();
  });
});
