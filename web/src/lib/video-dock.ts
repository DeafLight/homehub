// Place de la vignette vidéo de la tablette (VideoDock.svelte) : elle suit le doigt sans sortir de l'écran, puis se
// range dans le coin le plus proche, retenu d'une fois sur l'autre. Et l'écoute, par la tablette, des vidéos
// envoyées par les téléphones. Testé.
import type { TabletVideo } from '../../../shared/video.ts';
import type { Api } from './api.ts';

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** Coin par défaut : en bas à droite, loin des titres et du bouton retour. */
export const DEFAULT_CORNER: Corner = 'bottom-right';
/** Marge entre la vignette et le bord de l'écran. */
export const DOCK_MARGIN = 16;
/** Largeur de la vidéo en vignette (16:9), assez grande pour toucher « Ignorer » sur une pub. */
export const MINI_WIDTH = 400;
export const MINI_VIDEO_HEIGHT = Math.round((MINI_WIDTH * 9) / 16);

const STORAGE_KEY = 'homehub:videoCorner';

/** Coin haut-gauche de la vignette posée dans `corner`. */
export function cornerPosition(corner: Corner, size: Size, viewport: Size, margin = DOCK_MARGIN): Point {
  const left = corner.endsWith('left');
  const top = corner.startsWith('top');
  return clampPosition(
    { x: left ? margin : viewport.width - size.width - margin, y: top ? margin : viewport.height - size.height - margin },
    size,
    viewport,
    margin,
  );
}

/** Position gardée dans l'écran (avec la marge) ; une vignette plus grande que l'écran se cale en haut à gauche. */
export function clampPosition(p: Point, size: Size, viewport: Size, margin = DOCK_MARGIN): Point {
  const clamp = (value: number, max: number) => Math.max(margin, Math.min(value, Math.max(margin, max)));
  return { x: clamp(p.x, viewport.width - size.width - margin), y: clamp(p.y, viewport.height - size.height - margin) };
}

/** Coin le plus proche du centre de la vignette lâchée en `p`. */
export function nearestCorner(p: Point, size: Size, viewport: Size): Corner {
  const left = p.x + size.width / 2 < viewport.width / 2;
  const top = p.y + size.height / 2 < viewport.height / 2;
  return `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}`;
}

/** Coin retenu (stockage local), ou celui par défaut. */
export function loadCorner(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Corner {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return CORNERS.includes(value as Corner) ? (value as Corner) : DEFAULT_CORNER;
  } catch {
    return DEFAULT_CORNER;
  }
}

export function saveCorner(corner: Corner, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, corner);
  } catch {
    // stockage indisponible : le coin ne sera pas retenu
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Délai avant de réécouter après une erreur réseau. */
export const LISTEN_RETRY_MS = 5_000;

/**
 * Tablette : attend les vidéos envoyées par les téléphones (interrogation longue) et passe chacune à `onVideo`. La
 * première demande (`after` null) ne rejoue rien ; après une erreur, nouvel essai au bout de `retryMs`. Renvoie l'arrêt.
 */
export function listenTabletVideo({
  api,
  onVideo,
  retryMs = LISTEN_RETRY_MS,
}: {
  api: Pick<Api, 'tabletVideo'>;
  onVideo: (video: TabletVideo) => void;
  retryMs?: number;
}): () => void {
  const abort = new AbortController();
  void (async () => {
    let after: number | null = null;
    while (!abort.signal.aborted) {
      try {
        const reply = await api.tabletVideo(after, abort.signal);
        after = reply.last;
        if (reply.video && !abort.signal.aborted) onVideo(reply.video);
      } catch {
        if (abort.signal.aborted) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, retryMs);
          abort.signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
        });
      }
    }
  })();
  return () => abort.abort();
}
