// Message vocal enregistré vers un appareil Cast (Google Home, télé), depuis l'onglet Caméra d'un parent : le
// téléphone enregistre (MediaRecorder), puis envoie le fichier au serveur, qui le fait lire par l'appareil. Un appui
// pour commencer, un pour envoyer (ou annuler) ; au bout de `maxSeconds`, le message part de lui-même.
import type { Api } from './api.ts';
import { micError, phoneMicrophone } from './live-camera.ts';

/** Ce qu'il faut de MediaRecorder (remplaçable dans les tests). */
export type RecorderLike = {
  readonly mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(): void;
  stop(): void;
};
export type RecorderFactory = (stream: MediaStream, mimeType: string) => RecorderLike;

/** Où en est le message : `sent` dit sur quel appareil il est lu. */
export type VoiceState =
  | { phase: 'idle' }
  | { phase: 'recording'; target: string }
  | { phase: 'sending'; target: string }
  | { phase: 'sent'; device: string }
  | { phase: 'error'; message: string };

export const VOICE_MAX_SECONDS = 30;

/** Formats essayés, du préféré au dernier recours (Chrome : webm/opus ; Safari : mp4/aac). '' : celui du navigateur. */
const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
export function pickVoiceType(isSupported: (type: string) => boolean): string {
  return PREFERRED.find((t) => isSupported(t)) ?? '';
}

export const browserRecorder: RecorderFactory = (stream, mimeType) => {
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const like: RecorderLike = {
    get mimeType() {
      return recorder.mimeType;
    },
    ondataavailable: null,
    onstop: null,
    start: () => recorder.start(),
    stop: () => recorder.stop(),
  };
  recorder.ondataavailable = (e) => like.ondataavailable?.(e);
  recorder.onstop = () => like.onstop?.();
  return like;
};
const browserSupports = (type: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type);

export type VoiceRecorder = {
  /** Ouvre le micro et enregistre pour l'appareil `target`. */
  start(target: string): Promise<void>;
  /** Arrête et envoie. */
  finish(): void;
  /** Arrête sans rien envoyer. */
  cancel(): void;
};

export function createVoiceRecorder({
  api,
  onState,
  microphone = phoneMicrophone,
  createRecorder = browserRecorder,
  isSupported = browserSupports,
  maxSeconds = VOICE_MAX_SECONDS,
}: {
  api: Pick<Api, 'sendVoice'>;
  onState: (s: VoiceState) => void;
  microphone?: () => Promise<MediaStream>;
  createRecorder?: RecorderFactory;
  isSupported?: (type: string) => boolean;
  maxSeconds?: number;
}): VoiceRecorder {
  let current: { recorder: RecorderLike; stream: MediaStream; target: string; send: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
  let opening = false;

  const release = (stream: MediaStream) => {
    for (const track of stream.getTracks()) track.stop();
  };

  function stop(send: boolean) {
    if (!current) return;
    current.send = send;
    clearTimeout(current.timer);
    current.recorder.stop();
  }

  return {
    async start(target) {
      if (current || opening) return;
      opening = true;
      let stream: MediaStream;
      try {
        stream = await microphone();
      } catch (err) {
        onState({ phase: 'error', message: micError(err) });
        return;
      } finally {
        opening = false;
      }
      const mimeType = pickVoiceType(isSupported);
      let recorder: RecorderLike;
      try {
        recorder = createRecorder(stream, mimeType);
      } catch {
        release(stream);
        onState({ phase: 'error', message: 'Ce navigateur ne sait pas enregistrer de message.' });
        return;
      }
      const chunks: Blob[] = [];
      const session = { recorder, stream, target, send: false, timer: setTimeout(() => stop(true), maxSeconds * 1000) };
      current = session;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        release(stream);
        if (current === session) current = null;
        if (!session.send) return onState({ phase: 'idle' });
        const type = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm';
        const audio = new Blob(chunks, { type });
        if (audio.size === 0) return onState({ phase: 'error', message: 'Message vide : rien n’a été enregistré.' });
        onState({ phase: 'sending', target });
        api.sendVoice(target, audio).then(
          ({ device }) => onState({ phase: 'sent', device }),
          (err: Error) => onState({ phase: 'error', message: err.message }),
        );
      };
      recorder.start();
      onState({ phase: 'recording', target });
    },
    finish: () => stop(true),
    cancel: () => stop(false),
  };
}
