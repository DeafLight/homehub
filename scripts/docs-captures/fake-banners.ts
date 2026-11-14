// Applis inventées de la fausse télé du monde fictif (tiroir de la télécommande) et leurs bannières : petites images
// PNG 240×135 dessinées ici (dégradé et une forme simple), encodées à la main (zlib du système), sans bibliothèque.
// Aucun nom ni logo réel.
import { deflateSync } from 'node:zlib';
import type { ScreenApp } from '../../shared/screen.ts';

type Rgb = [number, number, number];
type Shape = 'play' | 'circle' | 'square' | 'note' | 'star' | 'wave';

const W = 240;
const H = 135;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: Buffer) => {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
};

/** Dans la forme ? Coordonnées centrées sur la bannière, en pixels. */
function inside(shape: Shape, x: number, y: number): boolean {
  const r = 34;
  switch (shape) {
    case 'play':
      return x > -22 && x < 30 && Math.abs(y) < (30 - x) * 0.65;
    case 'circle':
      return x * x + y * y < r * r && x * x + y * y > (r - 12) ** 2;
    case 'square':
      return Math.abs(x) < 28 && Math.abs(y) < 28 && (Math.abs(x) > 16 || Math.abs(y) > 16);
    case 'note':
      return ((x + 10) ** 2 + (y - 18) ** 2 < 144) || (x > -2 && x < 4 && y > -30 && y < 18) || (x > -2 && x < 22 && y > -30 && y < -22);
    case 'star': {
      const a = Math.atan2(y, x);
      const d = Math.hypot(x, y);
      return d < 18 + 18 * Math.abs(Math.cos(2.5 * a));
    }
    case 'wave':
      return Math.abs(y - 14 * Math.sin(x / 9)) < 6 && Math.abs(x) < 50;
  }
}

/** Bannière PNG : dégradé de `from` à `to`, forme claire au centre ; renvoyée en base64. */
export function bannerPng(from: Rgb, to: Rgb, shape: Shape): string {
  const rows: Buffer[] = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3);
    for (let x = 0; x < W; x++) {
      const t = (x + y) / (W + H);
      const on = inside(shape, x - W / 2, y - H / 2);
      for (let k = 0; k < 3; k++) row[1 + x * 3 + k] = on ? 245 : Math.round(from[k]! + (to[k]! - from[k]!) * t);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(W, 0);
  header.writeUInt32BE(H, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
  return png.toString('base64');
}

const APPS: [string, string, Rgb, Rgb, Shape][] = [
  ['fr.exemple.video', 'Vidéo+', [180, 40, 60], [90, 20, 50], 'play'],
  ['fr.exemple.cine', 'Ciné Club', [40, 40, 50], [120, 30, 30], 'star'],
  ['fr.exemple.box', 'Box TV', [30, 90, 160], [20, 40, 90], 'square'],
  ['fr.exemple.musique', 'Musique', [30, 140, 90], [20, 70, 60], 'note'],
  ['fr.exemple.dessins', 'Dessins animés', [230, 140, 30], [200, 70, 40], 'circle'],
  ['fr.exemple.sport', 'Sport Direct', [20, 110, 60], [10, 60, 90], 'wave'],
  ['fr.exemple.meteo', 'Météo', [60, 130, 200], [40, 70, 140], 'circle'],
  ['fr.exemple.jeux', 'Jeux', [110, 60, 170], [60, 30, 110], 'star'],
  ['fr.exemple.web', 'Navigateur', [70, 80, 100], [40, 45, 60], 'wave'],
];

/** Applis de la fausse télé, bannières comprises. */
export const fakeScreenApps = (): ScreenApp[] => APPS.map(([pkg, name, from, to, shape]) => ({ package: pkg, name, banner: bannerPng(from, to, shape) }));
