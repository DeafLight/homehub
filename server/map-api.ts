// Fond de la carte en route (chantier « Prochain trajet », version 3) : le fichier PMTiles d'Angers servi par HomeHub
// lui-même, par morceaux (requêtes `Range`, comme les lit la bibliothèque pmtiles du navigateur), pour que les tuiles,
// qui révèlent le quartier où l'on est, ne soient jamais demandées à un fournisseur extérieur. GET /map dit si le
// fichier est là (sinon la carte montre le tracé sur un fond uni). Réservé aux téléphones appairés : la tablette
// n'affiche pas de carte. Chemin du fichier : HOMEHUB_MAP_TILES, sinon `angers.pmtiles` dans le dossier d'état.
import { open, stat } from 'node:fs/promises';
import type { Access } from './access.ts';
import { createRouter } from './http.ts';

/** Morceau servi au plus par requête (la bibliothèque pmtiles en demande de 16 Ko à quelques centaines de Ko). */
export const MAX_RANGE_BYTES = 8 * 1024 * 1024;

/** Réponse de GET /api/map. */
export type MapInfo = { tiles: boolean };

/** Plage d'octets demandée (« bytes=a-b », « bytes=a- », « bytes=-n ») dans un fichier de `size` octets ; null : illisible ou hors du fichier. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start: number;
  let end: number;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || end < start) return null;
  return { start, end };
}

export function createMapApi({ tilesPath, access }: { tilesPath: () => string | undefined; access: Access }) {
  const api = createRouter();

  const sizeOf = async (path: string | undefined) => {
    if (!path) return null;
    try {
      const info = await stat(path);
      return info.isFile() ? info.size : null;
    } catch {
      return null;
    }
  };

  api.get('/map', async (c) => {
    await access.ownPhone(c);
    return c.json({ tiles: (await sizeOf(tilesPath())) !== null } satisfies MapInfo);
  });

  api.get('/map/tiles.pmtiles', async (c) => {
    await access.ownPhone(c);
    const path = tilesPath();
    const size = await sizeOf(path);
    if (size === null || !path) return c.json({ error: 'Pas de fond de carte' }, 404);
    const header = c.req.header('range');
    const range = header ? parseRange(header, size) : { start: 0, end: size - 1 };
    if (!range) return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    const end = Math.min(range.end, range.start + MAX_RANGE_BYTES - 1);
    const length = end - range.start + 1;
    const buffer = Buffer.alloc(length);
    const file = await open(path, 'r');
    try {
      await file.read(buffer, 0, length, range.start);
    } finally {
      await file.close();
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(length),
      // Le fichier change quelques fois par an : le navigateur le garde un jour.
      'Cache-Control': 'private, max-age=86400',
    };
    if (!header && end === size - 1) return c.body(buffer, 200, headers);
    return c.body(buffer, 206, { ...headers, 'Content-Range': `bytes ${range.start}-${end}/${size}` });
  });

  return api;
}
