// Tests du message vocal vers un appareil Cast : format choisi selon le navigateur, enregistrement puis envoi,
// annulation sans envoi, envoi automatique au bout de la durée maximale, micro refusé, refus du serveur, message vide ;
// le micro est toujours rendu.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceRecorder, pickVoiceType, type RecorderLike, type VoiceState } from './voice-message.ts';

class FakeRecorder implements RecorderLike {
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  started = false;
  constructor(
    readonly mimeType: string,
    private readonly data: Blob,
  ) {}
  start() {
    this.started = true;
  }
  stop() {
    this.ondataavailable?.({ data: this.data });
    this.onstop?.();
  }
}

function fakeStream() {
  const track = { stopped: false, stop() { track.stopped = true; } };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

function setup({ data = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), sendVoice = vi.fn(async () => ({ device: 'Google Home du salon' })), microphone }: { data?: Blob; sendVoice?: ReturnType<typeof vi.fn>; microphone?: () => Promise<MediaStream> } = {}) {
  const states: VoiceState[] = [];
  const { track, stream } = fakeStream();
  let recorder: FakeRecorder | null = null;
  const voice = createVoiceRecorder({
    api: { sendVoice: sendVoice as never },
    onState: (s) => states.push(s),
    microphone: microphone ?? (async () => stream),
    createRecorder: (_s, type) => (recorder = new FakeRecorder(type, data)),
    isSupported: (t) => t === 'audio/webm;codecs=opus',
    maxSeconds: 30,
  });
  return { voice, states, track, sendVoice, recorder: () => recorder! };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('format d’enregistrement', () => {
  it('webm/opus si possible, sinon mp4 (Safari), sinon celui du navigateur', () => {
    expect(pickVoiceType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickVoiceType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickVoiceType(() => false)).toBe('');
  });
});

describe('message vocal', () => {
  it('enregistre, envoie à l’appareil choisi, dit où il est lu, rend le micro', async () => {
    const { voice, states, track, sendVoice, recorder } = setup();
    await voice.start('salon');
    expect(recorder().started).toBe(true);
    expect(states.at(-1)).toEqual({ phase: 'recording', target: 'salon' });
    voice.finish();
    expect(track.stopped).toBe(true);
    expect(states.at(-1)).toEqual({ phase: 'sending', target: 'salon' });
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ phase: 'sent', device: 'Google Home du salon' }));
    const [device, audio] = sendVoice.mock.calls[0] as [string, Blob];
    expect(device).toBe('salon');
    expect(audio.type).toBe('audio/webm;codecs=opus');
    expect(audio.size).toBe(3);
  });

  it('annuler : rien n’est envoyé', async () => {
    const { voice, states, track, sendVoice } = setup();
    await voice.start('salon');
    voice.cancel();
    expect(states.at(-1)).toEqual({ phase: 'idle' });
    expect(track.stopped).toBe(true);
    expect(sendVoice).not.toHaveBeenCalled();
  });

  it('durée maximale : le message part de lui-même', async () => {
    const { voice, sendVoice } = setup();
    await voice.start('tele');
    vi.advanceTimersByTime(30_000);
    expect(sendVoice).toHaveBeenCalledOnce();
  });

  it('un seul enregistrement à la fois', async () => {
    const { voice, states } = setup();
    await voice.start('salon');
    await voice.start('tele');
    expect(states).toEqual([{ phase: 'recording', target: 'salon' }]);
  });

  it('micro refusé : message clair, rien n’est enregistré', async () => {
    const denied = Object.assign(new Error('non'), { name: 'NotAllowedError' });
    const { voice, states } = setup({ microphone: async () => Promise.reject(denied) });
    await voice.start('salon');
    expect(states).toEqual([{ phase: 'error', message: 'Micro refusé : autorise-le pour HomeHub dans le navigateur.' }]);
  });

  it('refus du serveur (appareil injoignable) : son message', async () => {
    const { voice, states } = setup({ sendVoice: vi.fn(async () => Promise.reject(new Error('Télé : appareil injoignable'))) });
    await voice.start('tele');
    voice.finish();
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ phase: 'error', message: 'Télé : appareil injoignable' }));
  });

  it('rien d’enregistré : pas d’envoi', async () => {
    const { voice, states, sendVoice } = setup({ data: new Blob([]) });
    await voice.start('salon');
    voice.finish();
    expect(states.at(-1)).toEqual({ phase: 'error', message: 'Message vide : rien n’a été enregistré.' });
    expect(sendVoice).not.toHaveBeenCalled();
  });
});
