// Parler en direct à la télé (fonction 9 de l'appli HomeHub TV, docs/appli-tele.md section 9) : le téléphone d'un
// parent envoie sa voix par petits morceaux, HomeHub les relaie à la télé, qui les lit au fur et à mesure son du
// programme baissé. Format commun au téléphone, au serveur et, recopié en Kotlin, à l'appli (tv-app, LiveTalk.kt).

/** Format du son : PCM 16 bits signés, petit-boutiste, mono, à cette fréquence. */
export const TALK_RATE = 16_000;
/** Octets par seconde de son (32 ko/s). */
export const TALK_BYTES_PER_SECOND = TALK_RATE * 2;
/** Le téléphone envoie un morceau à ce rythme (pendant un envoi, la suite attend et part avec le suivant). */
export const TALK_CHUNK_MS = 250;
/** Un envoi du téléphone fait au plus 2 s de son (réseau lent qui a laissé s'accumuler la suite). */
export const TALK_CHUNK_MAX_BYTES = TALK_BYTES_PER_SECOND * 2;
/** En-tête de la réponse à la télé : numéro du dernier morceau qu'elle contient (à redonner dans `after`). */
export const TALK_SEQ_HEADER = 'x-homehub-seq';

/** Événement envoyé à la télé : ouvrir le son à `audio` (chemin de l'API, avec le jeton de la télé), bandeau `title`. */
export type ScreenTalkEvent = { kind: 'talk'; id: string; title: string; audio: string; rate: number };

/** Réponse au téléphone qui commence à parler. */
export type ScreenTalkStart = { id: string; device: string; rate: number; maxSeconds: number };

/** Bandeau de la télé : « Alex vous parle ». */
export const talkTitle = (name: string | null) => (name ? `${name} vous parle` : 'Un parent vous parle');
