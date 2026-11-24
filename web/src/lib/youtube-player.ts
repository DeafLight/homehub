// Chargement de l'API IFrame de YouTube (script officiel, chargé une fois, à la première vidéo reçue) et le peu de
// types dont le lecteur de la tablette a besoin. Si `window.YT.Player` existe déjà (captures de la doc : faux lecteur
// sans aucune requête vers YouTube), il sert tel quel.

export type YouTubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  destroy(): void;
};

export type YouTubePlayerEvent = { target: YouTubePlayer; data: number };

export type YouTubePlayerOptions = {
  host?: string;
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, number | string>;
  events?: {
    onReady?: (event: YouTubePlayerEvent) => void;
    onStateChange?: (event: YouTubePlayerEvent) => void;
    onError?: (event: YouTubePlayerEvent) => void;
  };
};

export type YouTubeApi = { Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer };

type YouTubeWindow = { YT?: Partial<YouTubeApi>; onYouTubeIframeAPIReady?: () => void };

const API_URL = 'https://www.youtube.com/iframe_api';
const LOAD_TIMEOUT_MS = 20_000;

let loading: Promise<YouTubeApi> | null = null;

/** L'API IFrame, chargée au premier appel ; rejette si elle n'arrive pas (liste blanche de Fully, réseau). */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  const w = globalThis as unknown as YouTubeWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT as YouTubeApi);
  loading ??= new Promise<YouTubeApi>((resolve, reject) => {
    const timer = setTimeout(() => {
      loading = null;
      reject(new Error('Lecteur YouTube injoignable (liste blanche de Fully Kiosk ? voir le README)'));
    }, LOAD_TIMEOUT_MS);
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      resolve(w.YT as YouTubeApi);
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      loading = null;
      script.remove();
      reject(new Error('Lecteur YouTube injoignable (liste blanche de Fully Kiosk ? voir le README)'));
    };
    document.head.append(script);
  });
  return loading;
}
