// Icônes PNG de l'appli téléphone (manifeste PWA), dessinées comme favicon.svg : la maison au trait sur fond sombre.
// Fond plein et dessin dans la zone sûre centrale, pour qu'Android puisse les rogner (« maskable »).
// À relancer après un changement de dessin : node scripts/make-icons.ts
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const BACKGROUND = [0x18, 0x1b, 0x22];
const STROKE = [0xe8, 0xea, 0xed];
/** Tracés de l'icône « home » (grille 24×24), en segments. */
const LINES = [
  [3, 10.5, 12, 3, 21, 10.5],
  [5, 9.5, 5, 21, 19, 21, 19, 9.5],
  [10, 21, 10, 15, 14, 15, 14, 21],
];
const STROKE_WIDTH = 1.8;
/** Part de l'icône occupée par la grille 24×24 (zone sûre : le cercle de 80 % au centre). */
const SCALE = 0.55;
const SAMPLES = 4;

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function inStroke(x: number, y: number): boolean {
  for (const line of LINES) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      if (distanceToSegment(x, y, line[i], line[i + 1], line[i + 2], line[i + 3]) <= STROKE_WIDTH / 2) return true;
    }
  }
  return false;
}

function icon(size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  const unit = (size * SCALE) / 24;
  const offset = (size - 24 * unit) / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES - offset) / unit;
          const y = (py + (sy + 0.5) / SAMPLES - offset) / unit;
          if (inStroke(x, y)) hits++;
        }
      }
      const cover = hits / (SAMPLES * SAMPLES);
      const at = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) png.data[at + c] = Math.round(BACKGROUND[c] + (STROKE[c] - BACKGROUND[c]) * cover);
      png.data[at + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../web/public/icon-${size}.png`, import.meta.url), icon(size));
}
