// Caméra du scanner du stock : ouvre la caméra choisie (avant ou arrière), lit les codes-barres avec le
// BarcodeDetector du navigateur toutes les `DETECT_EVERY_MS`, et rend la caméra à l'arrêt. Un changement de caméra
// pendant l'ouverture de la précédente l'emporte (numéro de génération) : aucune piste ne reste allumée.
import { normalizeProductCode, PRODUCT_FORMATS, validProductCode } from '../../../shared/barcode.ts';
import type { Facing } from './scan.ts';

type Detected = { rawValue: string; format: string };
type Detector = { detect(source: HTMLVideoElement): Promise<Detected[]> };
type DetectorClass = { new (options?: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> };
const DetectorApi = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

/** Le navigateur sait-il lire les codes-barres ? Sinon, saisie à la main seulement. */
export const canDetectBarcodes = Boolean(DetectorApi);

const DETECT_EVERY_MS = 150;

export type BarcodeCameraOptions = {
  video: () => HTMLVideoElement | undefined;
  /** Une question à l'écran : on n'écoute plus la caméra (le produit reste peut-être devant). */
  paused: () => boolean;
  /** Codes valides vus sur une image (peut être vide). */
  onFrame: (codes: string[]) => void;
  /** L'image de la caméra s'affiche (avant même que le lecteur de codes soit prêt). */
  onOpen: () => void;
};

export type BarcodeCamera = {
  /** Ouvre la caméra ; rejette si elle ne s'ouvre pas (rien à faire si une autre ouverture l'a remplacée). */
  start(facing: Facing): Promise<'on' | 'replaced'>;
  stop(): void;
};

export function createBarcodeCamera({ video, paused, onFrame, onOpen }: BarcodeCameraOptions): BarcodeCamera {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let release: (() => void) | null = null;

  function stop() {
    generation++;
    clearTimeout(timer);
    release?.();
    release = null;
  }

  function loop(mine: number, detector: Detector) {
    const tick = async () => {
      const el = video();
      if (mine !== generation || !el) return;
      if (!paused()) {
        try {
          const codes = (await detector.detect(el)).filter((d) => validProductCode(d.rawValue, d.format)).map((d) => normalizeProductCode(d.rawValue, d.format));
          if (mine === generation) onFrame(codes);
        } catch {
          // Image pas encore prête : on réessaie au tour suivant.
        }
      }
      if (mine === generation) timer = setTimeout(tick, DETECT_EVERY_MS);
    };
    void tick();
  }

  async function start(facing: Facing): Promise<'on' | 'replaced'> {
    stop();
    const mine = generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const el = video();
    if (!el || mine !== generation) {
      for (const track of stream.getTracks()) track.stop();
      return 'replaced';
    }
    const off = () => {
      for (const track of stream.getTracks()) track.stop();
      if (el.srcObject === stream) el.srcObject = null; // pas celle d'une ouverture plus récente
    };
    el.srcObject = stream;
    await el.play();
    // Arrêtée pendant le démarrage de la vidéo : rien ne doit rester allumé.
    if (mine !== generation) {
      off();
      return 'replaced';
    }
    release = off;
    onOpen();
    if (DetectorApi) {
      const supported = await DetectorApi.getSupportedFormats().catch(() => [] as string[]);
      if (mine === generation) loop(mine, new DetectorApi({ formats: PRODUCT_FORMATS.filter((f) => supported.includes(f)) }));
    }
    return 'on';
  }

  return { start, stop };
}
