// Photo ou vidéo partagée vers la télé (fonction 11 de l'appli HomeHub TV, docs/appli-tele.md) : formats acceptés,
// taille au plus, durée d'affichage, et l'événement reçu par la télé. Communs au serveur, au front et, recopiés en
// Kotlin, à l'appli (tv-app/, Media.kt).

/** Photos acceptées (celles des téléphones, et ce qu'Android sait décoder). */
export const SCREEN_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'] as const;
/** Vidéos acceptées ; la télé dit si elle ne sait pas lire celle-ci. */
export const SCREEN_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/3gpp', 'video/quicktime'] as const;
export type ScreenMediaType = (typeof SCREEN_IMAGE_TYPES)[number] | (typeof SCREEN_VIDEO_TYPES)[number];

/** Taille au plus d'une photo ou d'une vidéo partagée (une minute de vidéo d'un téléphone, environ). */
export const SCREEN_MEDIA_MAX_BYTES = 50_000_000;
/** Une photo reste à l'écran ce temps au plus (Retour la ferme avant). */
export const SCREEN_PHOTO_SECONDS = 60;
/** Une vidéo se ferme à sa fin, ou au bout de ce temps au plus. */
export const SCREEN_VIDEO_MAX_SECONDS = 5 * 60;

export type ScreenMediaKind = 'photo' | 'video';

/** Genre d'un fichier d'après son type (« image/jpeg » → photo), ou null s'il n'est pas accepté. */
export function screenMediaKind(type: string | null | undefined): ScreenMediaKind | null {
  const base = (type ?? '').split(';')[0]!.trim().toLowerCase();
  if ((SCREEN_IMAGE_TYPES as readonly string[]).includes(base)) return 'photo';
  if ((SCREEN_VIDEO_TYPES as readonly string[]).includes(base)) return 'video';
  return null;
}

/** « Photo d’Alex », « Vidéo de Sam » : titre du bandeau sur la télé. */
export function screenMediaTitle(kind: ScreenMediaKind, name: string | null): string {
  const what = kind === 'photo' ? 'Photo' : 'Vidéo';
  if (!name) return what;
  return /^[aeiouyhàâäéèêëîïôöûüœæ]/iu.test(name) ? `${what} d’${name}` : `${what} de ${name}`;
}

/**
 * Photo à afficher en plein écran ou vidéo à lire : à télécharger à `url` (chemin de l'API, avec le jeton de la
 * télé) ; `seconds` : fermeture d'office au bout de ce temps.
 */
export type ScreenMediaEvent = { kind: 'media'; id: string; media: ScreenMediaKind; title: string; url: string; contentType: string; seconds: number };

/** Un fichier reçu par « Partager », vu du téléphone qui l'a partagé (avant de choisir la télé). */
export type SharedMedia = { id: string; kind: ScreenMediaKind; type: string; name: string; bytes: number };

/** Une télé où montrer une photo partagée. */
export type ShareScreenTarget = { id: string; name: string; online: boolean };
