// Photo inventée du monde fictif, partagée vers la télé depuis le téléphone (fonction 11) : un dessin (gâteau
// d'anniversaire sur une table, guirlande), photographié par Chrome pour en faire un JPEG ; puis la maquette de l'écran
// de la télé qui l'affiche en plein écran, avec le bandeau « Photo de Léa » de tv-app (MediaActivity). Rien de réel.

export const FAKE_SCREEN_MEDIA_FILE = 'fake-screen-media.json';

/** Ce que la fausse télé a reçu : titre, genre, fichier gardé dans le dossier d'état, taille. */
export type FakeScreenMedia = { title: string; media: 'photo' | 'video'; file: string; contentType: string; bytes: number };

/** La « photo » : page à photographier en 1600×1200 (format d'un téléphone en paysage, 4:3). */
export function fakePhotoHtml(): string {
  const flags = Array.from({ length: 14 }, (_, i) => {
    const x = 60 + i * 110;
    const y = 120 + Math.round(Math.sin(i / 2.2) * 26);
    const colors = ['#ef6f6c', '#f2b84b', '#5b8def', '#3fb8a8', '#b57edc'];
    return `<polygon points="${x},${y} ${x + 70},${y + 4} ${x + 34},${y + 86}" fill="${colors[i % colors.length]}"/>`;
  }).join('');
  const candles = [-90, -30, 30, 90]
    .map((dx) => `<rect x="${800 + dx - 9}" y="560" width="18" height="90" rx="6" fill="#f6f1e7"/><ellipse cx="${800 + dx}" cy="540" rx="13" ry="24" fill="#ffd166"/><ellipse cx="${800 + dx}" cy="546" rx="6" ry="12" fill="#fff4d0"/>`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>html, body { margin: 0; width: 1600px; height: 1200px; overflow: hidden; }</style>
<svg width="1600" height="1200" viewBox="0 0 1600 1200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3dcc2"/><stop offset="1" stop-color="#e7c29f"/></linearGradient>
    <linearGradient id="table" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a86b45"/><stop offset="1" stop-color="#7a4a2e"/></linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.45" r="0.5"><stop offset="0" stop-color="#fff3c4" stop-opacity="0.8"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1600" height="1200" fill="url(#mur)"/>
  <path d="M0 110 Q 800 190 1600 110" stroke="#8a6a4f" stroke-width="5" fill="none"/>
  ${flags}
  <circle cx="800" cy="600" r="420" fill="url(#halo)"/>
  <rect y="880" width="1600" height="320" fill="url(#table)"/>
  <ellipse cx="800" cy="930" rx="420" ry="60" fill="#f6f1e7"/>
  <rect x="520" y="700" width="560" height="220" rx="24" fill="#8b4f2c"/>
  <rect x="520" y="650" width="560" height="110" rx="40" fill="#f7d6e0"/>
  <path d="M520 740 q 35 40 70 0 t 70 0 t 70 0 t 70 0 t 70 0 t 70 0 t 70 0 t 70 0" fill="#f7d6e0"/>
  ${[560, 640, 720, 880, 960, 1040].map((x, i) => `<circle cx="${x}" cy="${690 + (i % 2) * 18}" r="12" fill="${i % 2 ? '#e94f64' : '#5b8def'}"/>`).join('')}
  ${candles}
  <circle cx="270" cy="860" r="70" fill="#5b8def"/><path d="M270 930 q -10 60 10 120" stroke="#8a6a4f" stroke-width="4" fill="none"/>
  <circle cx="1340" cy="830" r="80" fill="#ef6f6c"/><path d="M1340 910 q 12 70 -8 140" stroke="#8a6a4f" stroke-width="4" fill="none"/>
</svg>`;
}

const escape = (s: string) => s.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Maquette d'écran de télé (1280×720) : la photo en plein écran sur fond noir, et le bandeau du titre en haut à gauche
 * (couleurs du thème sombre de HomeHub ; allure fidèle à tv-app, MediaActivity).
 */
export function fakeScreenPhotoTv(media: FakeScreenMedia, data: Buffer): string {
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #000; font-family: Roboto, system-ui, sans-serif; }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .titre { position: absolute; top: 28px; left: 32px; padding: 12px 20px; border-radius: 18px; background: rgba(24,27,34,.94); color: #e8eaed; font-size: 26px; font-weight: 700; }
</style>
<img src="data:${media.contentType};base64,${data.toString('base64')}" alt="">
<div class="titre">${escape(media.title)}</div>`;
}
