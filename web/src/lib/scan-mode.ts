// Mode du scanner choisi par un QR code : les affichettes imprimées (« Frigo · placard », « Poubelle · tri ») portent
// l'adresse du scanner avec son mode (/m/scanner?mode=ranger ou ?mode=jete). Lue par la caméra du scanner, cette
// adresse fait basculer de mode, sans jamais être ouverte ni suivie. Un QR étranger, d'une autre origine, vers une autre
// page ou sans mode connu, est ignoré. Les modes lus passent par la garde du scanner (lib/scan-gate.ts) sous forme de
// jetons `mode:in` / `mode:out`, qu'aucun code-barres (que des chiffres) ne peut imiter : un QR laissé devant la caméra
// ne bascule qu'une fois.
import { PHONE_SCAN_PATH, scanModeOfParam } from './route.ts';
import type { ScanMode } from './scan.ts';

/** Nom affiché de chaque mode (bandeau de bascule). */
export const SCAN_MODE_LABELS: Record<ScanMode, string> = { in: 'Ranger les courses', out: 'Jeté / épuisé' };

/** Mode porté par le texte d'un QR code, s'il mène au scanner de cette origine avec un mode connu. */
export function scanModeOfQr(text: string, origin: string): ScanMode | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if ((url.pathname.replace(/\/$/, '') || '/') !== PHONE_SCAN_PATH) return null;
  return scanModeOfParam(url.searchParams.get('mode')) ?? null;
}

const TOKEN_PREFIX = 'mode:';

/** Jeton du mode pour la garde du scanner. */
export const modeToken = (mode: ScanMode) => `${TOKEN_PREFIX}${mode}`;

/** Mode d'un jeton rendu par la garde ; null pour un code-barres. */
export function tokenMode(read: string): ScanMode | null {
  if (!read.startsWith(TOKEN_PREFIX)) return null;
  const mode = read.slice(TOKEN_PREFIX.length);
  return mode === 'in' || mode === 'out' ? mode : null;
}

/** Lectures d'une image pour la garde : les codes-barres, puis les jetons des QR HomeHub (un par mode, les autres QR écartés). */
export function scanReads(codes: string[], qrTexts: string[], origin: string): string[] {
  const modes = new Set(qrTexts.map((text) => scanModeOfQr(text, origin)).filter((mode) => mode !== null));
  return [...codes, ...[...modes].map(modeToken)];
}

/** Bandeau de la bascule : titre et rappel de ce qu'il faut présenter. */
export function modeSwitchFlash(mode: ScanMode): { title: string; detail: string } {
  return {
    title: `Mode ${SCAN_MODE_LABELS[mode]}`,
    detail: mode === 'in' ? 'Présente les produits à ranger' : 'Présente les paquets vides ou jetés',
  };
}
