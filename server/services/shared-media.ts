// Photos et vidéos partagées vers la télé, en mémoire seulement. Deux temps, comme une page enregistrée partagée
// (recipe-imports.ts) : le menu Partager du téléphone poste le fichier sur /partager sans jeton (une navigation ne
// porte pas l'en-tête du téléphone), il attend dans la boîte de réception sous un numéro tiré au hasard ; la page du
// téléphone, elle authentifiée, le montre puis l'envoie à une télé. Le serveur le garde alors derrière une adresse
// impossible à deviner, comme un message vocal (voice-messages.ts), que la télé télécharge avec son jeton.
// Peu de places et peu de temps : la boîte se remplit sans authentification, elle ne doit pas remplir la mémoire.
import { randomBytes, randomUUID } from 'node:crypto';
import { SCREEN_MEDIA_MAX_BYTES, screenMediaKind, type ScreenMediaKind, type SharedMedia } from '../../shared/screen-media.ts';
import type { Clock } from '../sources/types.ts';

/** Un fichier reçu : contenu, type de base (« image/jpeg »), nom donné par le téléphone. */
export type MediaFile = { data: Uint8Array; type: string; kind: ScreenMediaKind; name: string };

/** Un fichier reçu attend son envoi à une télé ce temps au plus. */
export const SHARE_INBOX_TTL_MS = 10 * 60_000;
/** Fichiers en attente au plus (les plus anciens partent). */
export const SHARE_INBOX_MAX = 2;
/** Un fichier envoyé reste téléchargeable par la télé ce temps au plus. */
export const MEDIA_CLIP_TTL_MS = 5 * 60_000;
const MAX_CLIPS = 3;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
};

/** Type d'après l'extension du nom, quand le téléphone n'en donne pas (« IMG_0001.JPG » → image/jpeg). */
export function typeFromName(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/iu.exec(name)?.[1]?.toLowerCase();
  if (ext === 'jpeg') return 'image/jpeg';
  return Object.entries(EXTENSIONS).find(([, e]) => e === ext)?.[0] ?? null;
}

/** Refus d'un fichier, avec le statut HTTP qui va avec. */
export class MediaError extends Error {
  readonly status: 400 | 404 | 410 | 413;
  constructor(status: 400 | 404 | 410 | 413, message: string) {
    super(message);
    this.name = 'MediaError';
    this.status = status;
  }
}

export const MEDIA_TYPE_REFUSED = 'Seules les photos et les vidéos se montrent sur la télé';
export const MEDIA_TOO_BIG = `Fichier trop lourd pour la télé (${SCREEN_MEDIA_MAX_BYTES / 1_000_000} Mo au plus)`;
export const MEDIA_EXPIRED = 'Photo partagée expirée : partage-la de nouveau';

/** Vérifie un fichier reçu (type, taille) ; lève MediaError sinon. */
export function checkMedia(data: Uint8Array, rawType: string, name: string): MediaFile {
  const base = rawType.split(';')[0]!.trim().toLowerCase();
  const type = screenMediaKind(base) ? base : (typeFromName(name) ?? base);
  const kind = screenMediaKind(type);
  if (!kind) throw new MediaError(400, MEDIA_TYPE_REFUSED);
  if (data.byteLength === 0) throw new MediaError(400, 'Fichier vide');
  if (data.byteLength > SCREEN_MEDIA_MAX_BYTES) throw new MediaError(413, MEDIA_TOO_BIG);
  return { data, type, kind, name: name.slice(0, 200) };
}

export type SharedMediaStore = ReturnType<typeof createSharedMedia>;

export function createSharedMedia({ clock, inboxMax = SHARE_INBOX_MAX }: { clock: Clock; inboxMax?: number }) {
  const now = () => clock().getTime();
  const inbox = new Map<string, MediaFile & { expiresAt: number }>();
  const clips = new Map<string, MediaFile & { expiresAt: number }>();

  const sweep = (map: Map<string, { expiresAt: number }>, max: number) => {
    for (const [key, entry] of map) if (entry.expiresAt <= now()) map.delete(key);
    while (map.size > max) map.delete(map.keys().next().value!);
  };

  const pending = (id: string): MediaFile | null => {
    sweep(inbox, inboxMax);
    return inbox.get(id) ?? null;
  };

  return {
    /** Fichier reçu par « Partager » (déjà vérifié par checkMedia) : son numéro dans la boîte de réception. */
    receive(file: MediaFile): string {
      const id = randomUUID();
      inbox.set(id, { ...file, expiresAt: now() + SHARE_INBOX_TTL_MS });
      sweep(inbox, inboxMax);
      return id;
    },

    /** Le fichier en attente sous `id`, sans le retirer (on peut le montrer sur une autre télé). */
    pending,

    /** Ce que le téléphone voit d'un fichier en attente. */
    describe(id: string): SharedMedia | null {
      const file = pending(id);
      return file ? { id, kind: file.kind, type: file.type, name: file.name, bytes: file.data.byteLength } : null;
    },

    /** Garde `file` pour la télé derrière une adresse tirée au hasard : le jeton et l'extension. */
    keep(file: MediaFile): { token: string; extension: string } {
      sweep(clips, MAX_CLIPS - 1);
      const token = randomBytes(24).toString('base64url');
      clips.set(token, { ...file, expiresAt: now() + MEDIA_CLIP_TTL_MS });
      return { token, extension: EXTENSIONS[file.type] ?? 'bin' };
    },

    /** Le fichier derrière `token` (extension permise), s'il n'a pas expiré. */
    clip(token: string): MediaFile | null {
      sweep(clips, MAX_CLIPS);
      return clips.get(token.replace(/\.[a-z0-9]+$/iu, '')) ?? null;
    },
  };
}
