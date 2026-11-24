// Lien YouTube reçu par « Partager » (l'appli YouTube l'envoie le plus souvent dans le champ `text`, parfois avec le
// titre devant) : identifiant de la vidéo et instant de départ, ou null si ce n'est pas une vidéo YouTube. Et les
// petites règles du lecteur de la tablette (adresse du lecteur, paramètres, états). Fonctions pures, testées.
import { VIDEO_START_MAX, YOUTUBE_ID, type VideoHost, type VideoShare } from '../../../shared/video.ts';

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;

/** Domaines de YouTube (avec ou sans www., m., music.). */
const YOUTUBE_HOSTS = /^(?:(?:www|m|music)\.)?(?:youtube\.com|youtube-nocookie\.com)$/i;

/** « 90 », « 90s », « 1m30s », « 1h2m3s » → secondes ; 0 si illisible ou trop long. */
export function parseStart(value: string | null | undefined): number {
  const raw = value?.trim().toLowerCase() ?? '';
  if (!raw) return 0;
  let seconds: number;
  if (/^\d+s?$/.test(raw)) seconds = Number.parseInt(raw, 10);
  else {
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
    if (!match || !(match[1] || match[2] || match[3])) return 0;
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  }
  return Number.isFinite(seconds) && seconds <= VIDEO_START_MAX ? seconds : 0;
}

/** Vidéo d'une adresse YouTube, ou null. */
export function youTubeFromUrl(raw: string): VideoShare | null {
  let url: URL;
  try {
    url = new URL(raw.replace(/[).,;!?»]+$/, ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (host === 'youtu.be' || host === 'www.youtu.be') id = parts[0];
  else if (YOUTUBE_HOSTS.test(host)) {
    if (parts[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
    else if (['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '')) id = parts[1];
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  // `t=` dans la requête (lien « à partir de »), ou `#t=` dans les anciens liens ; `start=` des liens intégrés.
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const start = parseStart(url.searchParams.get('t') ?? url.searchParams.get('start') ?? hash.get('t'));
  return { videoId: id, start };
}

/** Première vidéo YouTube trouvée dans un texte (lien seul, ou « Titre https://youtu.be/… »). */
export function youTubeInText(text: string | null | undefined): VideoShare | null {
  for (const match of text?.match(URL_IN_TEXT) ?? []) {
    const found = youTubeFromUrl(match);
    if (found) return found;
  }
  return null;
}

/** Vidéo YouTube reçue par « Partager » (champs `url`, `text`, puis `title`), ou null. */
export function sharedYouTube(params: URLSearchParams): VideoShare | null {
  return youTubeInText(params.get('url')) ?? youTubeInText(params.get('text')) ?? youTubeInText(params.get('title'));
}

/** « 1 h 02 min 05 s », « 1 min 30 s », « 42 s ». */
export function formatStart(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h) return `${h} h ${pad(m)} min ${pad(s)} s`;
  if (m) return s ? `${m} min ${pad(s)} s` : `${m} min`;
  return `${s} s`;
}

/** Origine du lecteur intégré selon le réglage `video.host`. */
export const playerHost = (host: VideoHost) => `https://www.${host}`;

/** Paramètres du lecteur : lecture tout de suite, dans la page, sans vidéos d'autres chaînes à la fin. */
export function playerVars(start: number): Record<string, number> {
  return { autoplay: 1, playsinline: 1, rel: 0, fs: 0, ...(start > 0 && { start }) };
}

/** États du lecteur (API IFrame : YT.PlayerState). */
export const PLAYER_STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;

/**
 * La vidéo tourne-t-elle, au sens de la tablette (pas de veille, pas de retour à l'accueil, rechargements différés) ?
 * Elle se lit ou charge ; un état inconnu ne change rien (`previous`).
 */
export function playingAfter(state: number, previous: boolean): boolean {
  if (state === PLAYER_STATE.playing || state === PLAYER_STATE.buffering) return true;
  if (state === PLAYER_STATE.paused || state === PLAYER_STATE.ended || state === PLAYER_STATE.cued) return false;
  return previous;
}
