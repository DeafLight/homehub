// Photo ou vidéo reçue par « Partager » pour la télé (fonction 11) : ce que dit l'adresse de la page (/partager?media=…
// ou ?erreur=media-…, posée par le serveur), la taille lisible, le compte rendu d'un envoi. Fonctions pures, testées.
import { SCREEN_MEDIA_MAX_BYTES, type ScreenMediaKind, type ShareScreenTarget } from '../../../shared/screen-media.ts';

export type SharedMediaParam = { kind: 'media'; id: string } | { kind: 'error'; message: string };

export const MEDIA_FORMAT_ERROR = 'Seules les photos et les vidéos se montrent sur la télé.';
export const MEDIA_TOO_BIG_ERROR = `Fichier trop lourd pour la télé : ${SCREEN_MEDIA_MAX_BYTES / 1_000_000} Mo au plus (une minute de vidéo environ).`;

/** Photo ou vidéo à montrer sur la télé, ou pourquoi le serveur l'a refusée ; null : autre chose partagé. */
export function sharedMediaParam(params: URLSearchParams): SharedMediaParam | null {
  const id = params.get('media');
  if (id) return { kind: 'media', id };
  const error = params.get('erreur');
  if (error === 'media-format') return { kind: 'error', message: MEDIA_FORMAT_ERROR };
  if (error === 'media-trop-lourd') return { kind: 'error', message: MEDIA_TOO_BIG_ERROR };
  return null;
}

/** « 850 ko », « 4,2 Mo ». */
export function mediaSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} ko`;
  return `${(bytes / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

/** Ce qu'on dit après l'envoi : « Photo affichée sur Télé du salon ». */
export function sentNotice(kind: ScreenMediaKind, device: string): string {
  return kind === 'photo' ? `Photo affichée sur ${device}` : `Vidéo lancée sur ${device}`;
}

/** Télé choisie d'avance : la seule allumée, ou la seule tout court. */
export function defaultTarget(targets: ShareScreenTarget[]): string | null {
  const online = targets.filter((t) => t.online);
  if (online.length === 1) return online[0]!.id;
  return targets.length === 1 ? targets[0]!.id : null;
}
