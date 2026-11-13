// Messages vocaux vers les appareils Cast (Google Home, télé) : le téléphone d'un parent envoie un enregistrement, le
// serveur le garde quelques minutes en mémoire derrière une adresse impossible à deviner, puis demande à l'appareil de
// le lire (client Cast v2, services/cast.ts). L'appareil ne sait pas s'authentifier : il télécharge le message à cette
// adresse, servie par `GET /api/cast/clips/:token`, depuis `cast.mediaUrl` (adresse du NAS vue du réseau local).
// Rien n'est écrit sur le disque ; un message expire et disparaît de lui-même.
import { randomBytes } from 'node:crypto';
import type { CastConfig } from '../config.ts';
import type { Clock } from '../sources/types.ts';
import { CastError, type CastMedia, type CastTarget, castPlay } from './cast.ts';

/** Types d'enregistrement acceptés (MediaRecorder : webm/opus sur Android, mp4/aac sur iPhone) et lus par Cast. */
export const VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav'] as const;
export const VOICE_MAX_BYTES = 3_000_000;
/** Durée de vie d'un message en mémoire : de quoi le télécharger, le relire, pas davantage. */
export const VOICE_TTL_MS = 5 * 60_000;
const MAX_CLIPS = 20;

/** `fetched` : l'appareil l'a téléchargé (pour dire, en cas d'échec, si l'adresse était joignable). */
export type VoiceClip = { data: Uint8Array; contentType: string; expiresAt: number; fetched?: boolean };

export type VoiceMessages = {
  /** Fait lire `audio` par l'appareil `deviceId` ; rejette avec un message pour l'écran. Renvoie le nom de l'appareil. */
  send(deviceId: string, audio: Uint8Array, contentType: string, senderName: string): Promise<{ device: string }>;
  /**
   * Garde `audio` quelques minutes derrière une adresse tirée au hasard (pour l'appli HomeHub TV) ; rejette comme
   * `send` un format refusé, un message vide ou trop long. Renvoie le jeton et l'extension du fichier.
   */
  keep(audio: Uint8Array, contentType: string): { token: string; extension: string; contentType: string };
  /** Le message derrière `token`, s'il n'a pas expiré. */
  clip(token: string): VoiceClip | null;
};

/** Refus d'un envoi, avec le statut HTTP qui va avec. */
export class VoiceError extends Error {
  readonly status: 400 | 404 | 502 | 503;

  constructor(status: 400 | 404 | 502 | 503, message: string) {
    super(message);
    this.name = 'VoiceError';
    this.status = status;
  }
}

/** Type de base d'un enregistrement (« audio/webm;codecs=opus » → « audio/webm »), ou null s'il n'est pas accepté. */
export function voiceType(header: string | undefined): (typeof VOICE_TYPES)[number] | null {
  const base = (header ?? '').split(';')[0]!.trim().toLowerCase();
  return (VOICE_TYPES as readonly string[]).includes(base) ? (base as (typeof VOICE_TYPES)[number]) : null;
}

const EXTENSIONS: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };

export function createVoiceMessages({
  rules,
  clock,
  play = castPlay,
  logger = console,
}: {
  rules: () => CastConfig;
  clock: Clock;
  /** Lecture sur l'appareil (remplaçable dans les tests) ; `log` reçoit ses étapes. */
  play?: (target: CastTarget, media: CastMedia, options: { log: (step: string) => void }) => Promise<void>;
  /** Journal des étapes de chaque envoi (sans le contenu ni l'expéditeur). */
  logger?: Pick<Console, 'log'>;
}): VoiceMessages {
  const clips = new Map<string, VoiceClip>();

  const sweep = () => {
    const now = clock().getTime();
    for (const [token, clip] of clips) if (clip.expiresAt <= now) clips.delete(token);
    // Au-delà de la limite, les plus anciens partent (ordre d'insertion de la Map).
    while (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value!);
  };

  function keep(audio: Uint8Array, contentType: string) {
    const type = voiceType(contentType);
    if (!type) throw new VoiceError(400, 'Format d’enregistrement non pris en charge');
    if (audio.byteLength === 0) throw new VoiceError(400, 'Message vide');
    if (audio.byteLength > VOICE_MAX_BYTES) throw new VoiceError(400, 'Message trop long');
    sweep();
    const token = randomBytes(24).toString('base64url');
    clips.set(token, { data: audio, contentType: type, expiresAt: clock().getTime() + VOICE_TTL_MS });
    return { token, extension: EXTENSIONS[type]!, contentType: type };
  }

  return {
    keep,

    async send(deviceId, audio, contentType, senderName) {
      const { devices, mediaUrl } = rules();
      const device = devices.find((d) => d.id === deviceId);
      if (!device) throw new VoiceError(404, 'Appareil inconnu');
      if (!mediaUrl) throw new VoiceError(503, 'Adresse du NAS pour les appareils non configurée (cast.mediaUrl)');
      const { token, extension, contentType: type } = keep(audio, contentType);
      const clip = clips.get(token)!;
      const url = `${mediaUrl.replace(/\/+$/, '')}/api/cast/clips/${token}.${extension}`;
      try {
        const log = (text: string) => logger.log(`Cast ${device.id} : ${text}`);
        log(`message de ${audio.byteLength} octets (${type})`);
        await play({ host: device.host, port: device.port }, { url, contentType: type, title: `Message de ${senderName}` }, { log });
      } catch (err) {
        clips.delete(token);
        // Échec pendant la lecture sans téléchargement : l'appareil n'a sans doute pas pu joindre cast.mediaUrl.
        const hint = err instanceof CastError && err.stage === 'play' && !clip.fetched ? ', message jamais téléchargé (cast.mediaUrl joignable ?)' : '';
        throw new VoiceError(502, `${device.name} : ${(err as Error).message}${hint}`);
      }
      return { device: device.name };
    },

    clip(token) {
      sweep();
      const clip = clips.get(token.replace(/\.[a-z0-9]+$/, ''));
      if (!clip || clip.expiresAt <= clock().getTime()) return null;
      clip.fetched = true;
      return clip;
    },
  };
}
