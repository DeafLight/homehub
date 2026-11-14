// Parler en direct à la télé (fonction 9) depuis l'onglet Caméra d'un parent : le micro du téléphone, réduit à 16 kHz
// en PCM 16 bits, part vers HomeHub par morceaux numérotés (un tous les quarts de seconde ; pendant un envoi, la suite
// attend et part avec le suivant), et HomeHub le relaie à la télé, qui le lit son du programme baissé. Le micro s'ouvre
// avant de prévenir la télé (la demande d'autorisation ne laisse pas la télé attendre). Fin : le parent arrête, quitte
// l'onglet, ou le serveur répond que c'est fini (410, avec la raison). Logique testable ; la capture par Web Audio
// (browserCapture) n'est que la colle avec le navigateur.
import { TALK_CHUNK_MAX_BYTES, TALK_CHUNK_MS, TALK_RATE, type ScreenTalkStart } from '../../../shared/screen-talk.ts';
import { ApiError, type Api } from './api.ts';
import { micError, phoneMicrophone } from './live-camera.ts';

/**
 * Réduit un morceau de son (nombres de -1 à 1, à `fromRate`) à `toRate` en PCM 16 bits : moyenne des échantillons
 * de chaque intervalle (filtre simple contre le repliement, suffisant pour la voix). Ce qui reste d'un morceau compte
 * dans le suivant : les morceaux se suivent sans couture.
 */
export function createDownsampler(fromRate: number, toRate = TALK_RATE) {
  // Calcul en entiers (à la Bresenham) : chaque échantillon d'entrée avance de `toRate` ; un échantillon de sortie
  // tombe à chaque `fromRate` franchi. Aucune dérive ni couture, quelle que soit la découpe des morceaux.
  const from = Math.round(fromRate);
  const to = Math.round(toRate);
  let acc = 0;
  let sum = 0;
  let count = 0;
  return (input: Float32Array): Int16Array => {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      sum += input[i]!;
      count++;
      acc += to;
      if (acc >= from) {
        acc -= from;
        const value = Math.max(-1, Math.min(1, sum / count));
        out.push(Math.round(value < 0 ? value * 0x8000 : value * 0x7fff));
        sum = 0;
        count = 0;
      }
    }
    return Int16Array.from(out);
  };
}

/** Morceaux de PCM collés en un seul corps (petit-boutiste, comme le lit la télé). */
export function joinPcm(parts: Int16Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, p) => sum + p.length * 2, 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const part of parts) {
    for (const sample of part) {
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return bytes;
}

/** Ce que fait le micro : donner des morceaux (nombres de -1 à 1) à sa fréquence, et s'arrêter. */
export type TalkCapture = { rate: number; stop(): void };
export type CaptureFactory = (onSamples: (samples: Float32Array) => void) => Promise<TalkCapture>;

/** Capture par Web Audio : micro du téléphone (suppression d'écho et de bruit), morceaux d'environ 40 ms. */
export const browserCapture: CaptureFactory = async (onSamples) => {
  const stream = await phoneMicrophone();
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Context();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor (ancien, mais partout, sans fichier de module à servir) ; sa sortie muette doit être branchée.
  const processor = context.createScriptProcessor(2048, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  processor.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  await context.resume().catch(() => {});
  return {
    rate: context.sampleRate,
    stop() {
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => {});
    },
  };
};

/** Où en est la prise de parole ; `live` dit sur quelle télé, `ended`/`error` pourquoi elle s'est arrêtée. */
export type TalkState =
  | { phase: 'idle' }
  | { phase: 'starting'; screen: string }
  | { phase: 'live'; screen: string; device: string }
  | { phase: 'ended'; message: string }
  | { phase: 'error'; message: string };

export type TalkApi = Pick<Api, 'startScreenTalk' | 'sendScreenTalk' | 'stopScreenTalk'>;

export type ScreenTalker = {
  /** Ouvre le micro et commence à parler à la télé `screen`. */
  start(screen: string): Promise<void>;
  /** Arrête (bouton, onglet quitté). */
  stop(): void;
};

export function createScreenTalker({
  api,
  onState,
  capture = browserCapture,
  chunkMs = TALK_CHUNK_MS,
}: {
  api: TalkApi;
  onState: (s: TalkState) => void;
  capture?: CaptureFactory;
  chunkMs?: number;
}): ScreenTalker {
  /** La prise en cours ; `token` change à chaque ouverture (une vieille réponse ne touche pas la nouvelle). */
  let current: { token: object; screen: string; mic: TalkCapture | null; talk: ScreenTalkStart | null; pending: Int16Array[]; seq: number; sending: boolean; timer: ReturnType<typeof setInterval> | null } | null = null;

  function finish(state: TalkState, notify = true) {
    const was = current;
    current = null;
    if (!was) return;
    if (was.timer) clearInterval(was.timer);
    was.mic?.stop();
    if (notify && was.talk) void api.stopScreenTalk(was.screen, was.talk.id).catch(() => {});
    onState(state);
  }

  /** Envoie ce qui attend, si rien n'est en route ; un 410 ou un 404 termine la prise. */
  async function flush() {
    const talk = current;
    if (!talk?.talk || talk.sending || !talk.pending.length) return;
    let body = joinPcm(talk.pending.splice(0));
    // Réseau très lent : on ne garde que les dernières secondes (la voix d'il y a longtemps ne sert plus).
    if (body.byteLength > TALK_CHUNK_MAX_BYTES) body = body.slice(body.byteLength - TALK_CHUNK_MAX_BYTES);
    talk.sending = true;
    try {
      await api.sendScreenTalk(talk.screen, talk.talk.id, ++talk.seq, body);
    } catch (err) {
      if (current !== talk) return;
      if (err instanceof ApiError && (err.status === 410 || err.status === 404)) return finish({ phase: 'ended', message: err.message }, false);
      // Autre erreur (réseau perdu un instant) : la suite repart au prochain tour ; le serveur arrête après 6 s de silence.
    } finally {
      talk.sending = false;
    }
  }

  return {
    async start(screen) {
      if (current) finish({ phase: 'idle' });
      const token = {};
      const talk: NonNullable<typeof current> = { token, screen, mic: null, talk: null, pending: [], seq: 0, sending: false, timer: null };
      current = talk;
      onState({ phase: 'starting', screen });
      let downsample: ((s: Float32Array) => Int16Array) | null = null;
      try {
        talk.mic = await capture((samples) => {
          if (current !== talk || !talk.talk || !downsample) return;
          const pcm = downsample(samples);
          if (pcm.length) talk.pending.push(pcm);
        });
      } catch (err) {
        if (current === talk) finish({ phase: 'error', message: micError(err) }, false);
        return;
      }
      if (current !== talk) return talk.mic.stop();
      downsample = createDownsampler(talk.mic.rate);
      try {
        talk.talk = await api.startScreenTalk(screen);
      } catch (err) {
        if (current === talk) finish({ phase: 'error', message: (err as Error).message }, false);
        return;
      }
      // Arrêté pendant l'ouverture : la télé est prévenue tout de suite.
      if (current !== talk) return void api.stopScreenTalk(screen, talk.talk.id).catch(() => {});
      talk.timer = setInterval(() => void flush(), chunkMs);
      onState({ phase: 'live', screen, device: talk.talk.device });
    },

    stop() {
      finish({ phase: 'idle' });
    },
  };
}
