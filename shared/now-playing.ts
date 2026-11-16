// Ce qui passe à la télé (fonction 18 de l'appli HomeHub TV, docs/appli-tele.md) : l'appli HomeHub TV lit la session
// média Android de l'appli qui joue (titre, sous-titre, lecture ou pause, position, durée, image) et l'envoie avec son
// état ; le serveur la nettoie et la date, la télécommande du téléphone l'affiche et fait avancer la position seule.
// Règles pures, communes au serveur et au front. Rien de plus que ce qui est déjà à l'écran de la télé.

/** États de lecture retenus (ceux d'Android, regroupés) ; une session arrêtée ou en erreur n'est pas envoyée. */
export const PLAYBACK_STATES = ['playing', 'paused', 'buffering'] as const;
export type PlaybackState = (typeof PLAYBACK_STATES)[number];

/** Longueur gardée d'un titre ou d'un sous-titre, après nettoyage. */
export const NOW_PLAYING_TEXT_MAX = 120;
/** Taille au plus de l'image (JPEG ou PNG en base64, sans préfixe) : la télé la réduit à 320 px de large. */
export const NOW_PLAYING_ARTWORK_MAX = 120_000;

/**
 * Ce que joue la télé, envoyé par l'appli dans son état (`ScreenStateReport.nowPlaying`). `package` : l'appli dont
 * vient la session (souvent celle du premier plan). `subtitle` : épisode et saison, chaîne, artiste, selon l'appli.
 * `positionMs` : position au moment de l'envoi ; `durationMs` : null si inconnue (télé en direct, la plupart du temps).
 */
export type ScreenNowPlaying = {
  package: string;
  title: string | null;
  subtitle: string | null;
  state: PlaybackState;
  positionMs: number | null;
  durationMs: number | null;
  /** Image du programme (affiche, vignette, logo de la chaîne) en base64, JPEG ou PNG ; null : aucune. */
  artwork: string | null;
};

/**
 * Ce qui passe, vu de la télécommande : l'appli (son nom si elle est dans la liste), le programme, et la position
 * recalculée par le serveur à l'instant de la réponse. `artworkId` : empreinte de l'image (null : aucune), à demander
 * à part (`GET /api/screens/:id/artwork`) quand elle change.
 */
export type RemoteNowPlaying = {
  package: string;
  app: string;
  title: string | null;
  subtitle: string | null;
  state: PlaybackState;
  positionMs: number | null;
  durationMs: number | null;
  artworkId: string | null;
};

/** Image de ce qui passe, en adresse data: (null : aucune, ou plus d'actualité). */
export type RemoteArtwork = { id: string | null; image: string | null };

/** Type de l'image d'après ses premiers octets en base64 (JPEG « /9j/ », PNG « iVBOR ») ; null : refusée. */
export function artworkType(base64: string): 'image/jpeg' | 'image/png' | null {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  return null;
}

// Caractères de contrôle et de mise en forme invisible : rien qui puisse cacher ou retourner le texte.
const INVISIBLE = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{AD}\u{61C}\u{200B}\u{200C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2060}-\u{206F}\u{FEFF}]/gu;

/** Titre ou sous-titre propre : espaces réduites, invisibles retirés, coupé à NOW_PLAYING_TEXT_MAX ; vide : null. */
export function cleanPlayingText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.normalize('NFC').replace(INVISIBLE, ' ').replace(/\s+/gu, ' ').trim();
  if (!text) return null;
  const chars = [...text];
  return chars.length <= NOW_PLAYING_TEXT_MAX ? text : `${chars.slice(0, NOW_PLAYING_TEXT_MAX - 1).join('').trimEnd()}…`;
}

/** Durée utile : positive et finie, sinon null (une session en direct annonce 0 ou -1). */
export const cleanDuration = (ms: number | null | undefined): number | null => (ms !== null && ms !== undefined && Number.isFinite(ms) && ms > 0 ? Math.round(ms) : null);

/**
 * Position `elapsedMs` après le relevé : elle avance en lecture seulement, sans dépasser la durée ; en pause ou en
 * chargement, elle reste. Null si la position est inconnue.
 */
export function positionAfter(p: Pick<ScreenNowPlaying, 'state' | 'positionMs' | 'durationMs'>, elapsedMs: number): number | null {
  if (p.positionMs === null) return null;
  const moved = p.state === 'playing' ? p.positionMs + Math.max(0, elapsedMs) : p.positionMs;
  return Math.max(0, p.durationMs === null ? moved : Math.min(moved, p.durationMs));
}

/** « 4:05 », « 52:10 », « 1:02:05 » (heures seulement s'il y en a). */
export function formatPlayTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export const PLAYBACK_LABELS: Record<PlaybackState, string> = { playing: 'Lecture', paused: 'En pause', buffering: 'Chargement…' };

/** Empreinte courte et stable d'une image (FNV-1a sur le base64) : la télécommande ne la recharge que si elle change. */
export function artworkId(base64: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < base64.length; i++) {
    h ^= base64.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}-${base64.length.toString(36)}`;
}
