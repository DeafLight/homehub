// Vidéo YouTube envoyée du téléphone à la tablette : ce qui passe entre les deux (identifiant de vidéo validé et
// instant de départ, jamais une adresse), commun au serveur et au front.

/** Identifiant d'une vidéo YouTube : 11 caractères parmi lettres, chiffres, « - » et « _ ». */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Instant de départ au plus (24 h) : au-delà, la vidéo part du début. */
export const VIDEO_START_MAX = 24 * 3600;

/** Domaine du lecteur : sans cookies par défaut ; youtube.com pour profiter d'un compte Premium connecté (sans pubs). */
export const VIDEO_HOSTS = ['youtube-nocookie.com', 'youtube.com'] as const;
export type VideoHost = (typeof VIDEO_HOSTS)[number];

/** Ce que le téléphone envoie. */
export type VideoShare = { videoId: string; start: number };

/** Ce que la tablette reçoit : la vidéo, son départ, et qui l'a envoyée (prénom). */
export type TabletVideo = VideoShare & { seq: number; from: string };

/** Réponse de l'attente de la tablette : la dernière vidéo arrivée après `after` (ou rien), et le dernier numéro. */
export type TabletVideoReply = { video: TabletVideo | null; last: number };
