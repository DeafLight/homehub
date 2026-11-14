// Partie pure des affichettes « scanne avant de ranger / jeter » (scripts/affichettes.ts) : lecture des arguments,
// validation de l'adresse de HomeHub, URL du scanner du téléphone et page HTML A4 (2 × 2 affichettes, QR code).
import { renderSVG } from 'uqr';

/** Adresse fictive utilisée sans argument (doc, aperçu) : jamais l'adresse réelle de la maison dans le dépôt. */
export const DEFAULT_BASE = 'https://homehub.example';
export const DEFAULT_PDF = 'affichettes-scan.pdf';

export interface Options {
  base: string;
  pdf: string;
  /** Capture PNG de la page en plus du PDF (aperçu de la doc). */
  png?: string;
}

/**
 * Adresse de base normalisée (sans « / » final) ; refuse ce qui n'est pas une adresse http(s) simple.
 * Un chemin est accepté (HomeHub servi sous un sous-dossier), ni requête ni ancre.
 */
export function normalizeBase(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`Adresse invalide : « ${raw} » (exemple : https://homehub.example)`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Adresse en http(s) attendue, pas « ${url.protocol} »`);
  }
  if (url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    throw new Error('Adresse sans « ? » ni « # » attendue : seulement l’adresse de HomeHub');
  }
  if (url.username || url.password) throw new Error('Adresse sans identifiant ni mot de passe attendue');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Mode dans lequel le QR ouvre le scanner : Ranger (frigo) ou Jeté / épuisé (poubelle). */
export type ScanMode = 'ranger' | 'jete';

/**
 * URL du scanner du téléphone (PWA sous /m) dans un mode, celle que le QR code ouvre.
 * Le scanner lit aussi ces QR depuis l'appli pour changer de mode ; un scanner plus ancien ignore `?mode=`.
 */
export function scannerUrl(base: string, mode: ScanMode): string {
  return `${normalizeBase(base)}/m/scanner?mode=${mode}`;
}

/** Arguments : `[adresse] [--sortie <fichier.pdf>] [--apercu <fichier.png>]`. */
export function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { base: DEFAULT_BASE, pdf: DEFAULT_PDF };
  let base: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`Valeur manquante après ${arg}`);
      return v;
    };
    if (arg === '--sortie' || arg === '-o') opts.pdf = value();
    else if (arg === '--apercu') opts.png = value();
    else if (arg.startsWith('-')) throw new Error(`Option inconnue : ${arg}`);
    else if (base !== undefined) throw new Error('Une seule adresse attendue');
    else base = arg;
  }
  opts.base = normalizeBase(base ?? DEFAULT_BASE);
  return opts;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Kind = 'frigo' | 'poubelle';

const CARDS: Record<Kind, { tag: string; ink: string; tint: string; icons: string[]; title: string; body: string; mode: ScanMode; tip: string }> = {
  frigo: {
    tag: 'Frigo · placard', ink: '#0f6e56', tint: '#e1f5ee', icons: ['shopping-bag', 'scan', 'fridge'],
    title: 'Bip d’abord,<br>on range après', body: 'HomeHub sait ce qu’on a, et ne le remet pas sur la liste de courses.',
    mode: 'ranger', tip: 'Une date dessus ? Tape-la.',
  },
  poubelle: {
    tag: 'Poubelle · tri', ink: '#993c1d', tint: '#faece7', icons: ['bottle', 'scan', 'trash'],
    title: 'Fini ? Bip,<br>et hop à la poubelle', body: 'Le produit épuisé est proposé pour la liste de courses.',
    mode: 'jete', tip: 'Code illisible ? Tape les chiffres.',
  },
};

/** Police d'icônes Tabler, version fixe (la même que celle des maquettes validées). */
export const ICONS_CSS = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css';

/**
 * Page HTML A4 portrait : deux affichettes « Frigo · placard » et deux « Poubelle · tri », traits de coupe.
 * Papier blanc imprimé : les couleurs sont fixes ici (pas le thème sombre de l'application).
 */
export function pageHtml(base: string): string {
  const arrow = '<i class="ti ti-arrow-right arrow"></i>';
  const card = (k: Kind) => {
    const c = CARDS[k];
    const url = scannerUrl(base, c.mode);
    const qr = renderSVG(url, { ecc: 'M', border: 2, pixelSize: 4, blackColor: '#1d1d1b', whiteColor: '#ffffff' });
    return `<section class="card" data-url="${escapeHtml(url)}" style="--ink:${c.ink};--tint:${c.tint}">
    <div class="tag">${c.tag}</div>
    <div class="icons">${c.icons.map((i) => `<i class="ti ti-${i}"></i>`).join(arrow)}</div>
    <h1>${c.title}</h1>
    <p class="body">${c.body}</p>
    <div class="foot">
      <div class="qr" title="${escapeHtml(url)}">${qr}</div>
      <p>Scanne-moi avec ton téléphone ou dans le <b>scanner HomeHub</b>.<br><span>${c.tip}</span></p>
    </div>
  </section>`;
  };
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Affichettes scan</title>
<link rel="stylesheet" href="${ICONS_CSS}">
<style>
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { background: #ffffff; }
body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: #1d1d1b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; position: relative; overflow: hidden; }
.page::before, .page::after { content: ""; position: absolute; border: 0 dashed #b4b2a9; }
.page::before { left: 50%; top: 0; bottom: 0; border-left-width: 0.3mm; }
.page::after { top: 50%; left: 0; right: 0; border-top-width: 0.3mm; }
.card { padding: 9mm 8mm 11mm; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 3.5mm; }
.tag { background: var(--tint); color: var(--ink); border-radius: 99px; padding: 1.2mm 4.5mm; font-size: 11pt; font-weight: 600; }
.icons { display: flex; align-items: center; gap: 2.5mm; font-size: 40pt; color: var(--ink); margin-top: 4mm; }
.icons .arrow { font-size: 22pt; color: #b4b2a9; }
h1 { font-size: 25pt; line-height: 1.15; margin: 4mm 0 1mm; white-space: nowrap; font-weight: 700; }
.body { font-size: 13pt; line-height: 1.4; color: #5f5e5a; margin: 0 4mm; }
.foot { margin-top: auto; width: 100%; border-top: 0.3mm dashed #b4b2a9; padding-top: 4mm; display: flex; align-items: center; gap: 4mm; text-align: left; }
.qr { width: 34mm; height: 34mm; flex: none; }
.qr svg { width: 100%; height: 100%; display: block; }
.foot p { margin: 0; font-size: 10.5pt; line-height: 1.4; color: #5f5e5a; }
.foot b { color: var(--ink); white-space: nowrap; }
.foot span { color: #888780; }
</style></head><body><div class="page">${card('frigo')}${card('poubelle')}${card('frigo')}${card('poubelle')}</div></body></html>`;
}
