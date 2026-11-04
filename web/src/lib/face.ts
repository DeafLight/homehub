// Reconnaissance faciale sur la tablette (bibliothèque Human, chargée seulement au premier usage) : de l'image de la
// caméra, on ne tire qu'une empreinte numérique du visage et deux scores contre une photo ou un écran. L'image ne
// quitte pas la tablette ; c'est le serveur qui compare l'empreinte aux visages enregistrés.
import type { Human } from '@vladmandic/human';

export type FaceReading = {
  embedding: number[];
  /** Visage réel plutôt qu'une photo (0 à 1). */
  real: number;
  /** Visage vivant plutôt qu'un écran (0 à 1). */
  live: number;
  /** Largeur du visage, en part de celle de l'image (0 à 1) : pour guider la distance. */
  size: number;
};

let human: Promise<Human> | null = null;

function load(): Promise<Human> {
  human ??= import('@vladmandic/human').then(async ({ default: HumanClass }) => {
    const instance = new HumanClass({
      modelBasePath: '/models/',
      backend: 'webgl',
      // Chaque image est analysée de nouveau : sans cela, les empreintes d'un enregistrement seraient identiques.
      cacheSensitivity: 0,
      filter: { enabled: false },
      gesture: { enabled: false },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      segmentation: { enabled: false },
      face: {
        enabled: true,
        detector: { rotation: false, maxDetected: 1, minConfidence: 0.5 },
        mesh: { enabled: true },
        attention: { enabled: false },
        iris: { enabled: false },
        emotion: { enabled: false },
        description: { enabled: true },
        antispoof: { enabled: true },
        liveness: { enabled: true },
      },
    });
    await instance.load();
    await instance.warmup();
    return instance;
  });
  human.catch(() => (human = null)); // échec (réseau, WebGL) : nouvel essai à la prochaine demande
  return human;
}

/** Prépare la bibliothèque et ses modèles (quelques secondes la première fois). */
export const prepareFaces = () => load().then(() => undefined);

/**
 * Visage vu par la caméra, ou null s'il n'y en a pas. Trop flou ou trop loin pour en tirer une empreinte : `embedding`
 * vide (quelqu'un est là, sans qu'on puisse dire qui).
 */
export async function readFace(video: HTMLVideoElement): Promise<FaceReading | null> {
  const result = await (await load()).detect(video);
  const face = result.face[0];
  if (!face) return null;
  const size = face.boxRaw?.[2] ?? 0;
  return { embedding: Array.from(face.embedding ?? []), real: face.real ?? 0, live: face.live ?? 0, size };
}

/** Message à afficher quand la caméra ou la bibliothèque ne démarre pas. */
export function cameraError(err: unknown): string {
  const name = (err as Error)?.name;
  if (name === 'NotAllowedError') return 'Caméra refusée : autorise-la dans Fully Kiosk (Enable Webcam Access) et Android';
  if (name === 'NotFoundError') return 'Pas de caméra sur cet appareil';
  if (!navigator.mediaDevices) return 'Caméra indisponible : page à ouvrir en https';
  return `Caméra indisponible : ${(err as Error)?.message ?? err}`;
}

/** Caméra de face de la tablette, affichée dans `video`. Renvoie la fonction qui l'éteint. */
export async function startCamera(video: HTMLVideoElement): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
  video.srcObject = stream;
  await video.play();
  return () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
}
