// Reconnaissance faciale sur la tablette (bibliothèque Human, chargée seulement au premier usage) : de l'image de la
// caméra, on ne tire qu'une empreinte numérique du visage et deux scores contre une photo ou un écran. L'image ne
// quitte pas la tablette ; c'est le serveur qui compare l'empreinte aux visages enregistrés. Le calcul passe par la
// carte graphique (WebGL), ou sans elle si `faces.backend` le demande : sur certaines tablettes, une mise à jour
// d'Android System WebView fausse ce calcul sans erreur (même empreinte pour tous les visages).
import type { Human } from '@vladmandic/human';
import type { FaceBackend } from '../../../shared/types.ts';

export type FaceReading = {
  embedding: number[];
  /** Visage réel plutôt qu'une photo (0 à 1). */
  real: number;
  /** Visage vivant plutôt qu'un écran (0 à 1). */
  live: number;
  /** Largeur du visage, en part de celle de l'image (0 à 1) : pour guider la distance. */
  size: number;
  /** Confiance du détecteur qu'il s'agit bien d'un visage (0 à 1). */
  confidence: number;
};

/** Confiance minimale du détecteur, par défaut (`faces.minConfidence` de homehub.yaml). */
export const DEFAULT_MIN_CONFIDENCE = 0.5;

/**
 * Moteur de calcul de la bibliothèque pour `faces.backend` : `webgl-safe` garde la carte graphique sans les noyaux
 * « empaquetés » ni les optimisations que Human active (WEBGL_USE_SHAPES_UNIFORMS, WEBGL_EXP_CONV), suspects connus
 * de résultats faux sur certaines puces graphiques Android ; `cpu` se passe de la carte graphique.
 */
export function engineFor(backend: FaceBackend): { backend: 'webgl' | 'cpu'; flags: Record<string, boolean> } {
  if (backend === 'cpu') return { backend: 'cpu', flags: {} };
  if (backend === 'webgl-safe') {
    return { backend: 'webgl', flags: { WEBGL_PACK: false, WEBGL_USE_SHAPES_UNIFORMS: false, WEBGL_EXP_CONV: false } };
  }
  return { backend: 'webgl', flags: {} };
}

let human: Promise<Human> | null = null;
/** Moteur de la bibliothèque chargée (un autre demandé : elle est rechargée). */
let loadedFor: FaceBackend = 'webgl';

function load(backend: FaceBackend = loadedFor): Promise<Human> {
  if (backend !== loadedFor) human = null;
  loadedFor = backend;
  human ??= import('@vladmandic/human').then(async ({ default: HumanClass }) => {
    const instance = new HumanClass({
      modelBasePath: '/models/',
      ...engineFor(backend),
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
        detector: { rotation: false, maxDetected: 1, minConfidence: DEFAULT_MIN_CONFIDENCE },
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

/** Prépare la bibliothèque et ses modèles (quelques secondes la première fois), avec le moteur `faces.backend`. */
export const prepareFaces = (backend: FaceBackend) => load(backend).then(() => undefined);

/**
 * Visage vu par la caméra, ou null s'il n'y en a pas (`minConfidence` : confiance minimale du détecteur). Trop flou ou
 * trop loin pour en tirer une empreinte : `embedding` vide (quelqu'un est là, sans qu'on puisse dire qui).
 */
export async function readFace(video: HTMLVideoElement, minConfidence = DEFAULT_MIN_CONFIDENCE): Promise<FaceReading | null> {
  const result = await (await load()).detect(video, { face: { detector: { minConfidence } } });
  const face = result.face[0];
  if (!face) return null;
  return {
    embedding: Array.from(face.embedding ?? []),
    real: face.real ?? 0,
    live: face.live ?? 0,
    size: face.boxRaw?.[2] ?? 0,
    confidence: face.boxScore ?? face.score ?? 0,
  };
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
