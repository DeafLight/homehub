// Tracés géographiques de la carte en route (chantier « Prochain trajet », version 3) : polyline Google (MOTIS donne
// le tracé de chaque étape et de chaque course ainsi), longueurs le long d'un tracé, projection d'un point ou des arrêts
// d'une course sur son tracé, point à une distance donnée et distance d'un point au tracé. Les calculs se font dans un
// plan local (équirectangulaire, en mètres) : à l'échelle d'une ville, l'erreur reste de l'ordre du mètre.
import type { LatLon } from './trip.ts';

/** Point d'un tracé : [longitude, latitude], comme GeoJSON et MapLibre. */
export type LonLat = [number, number];

/** Décode une polyline Google (précision 6 pour MOTIS 2, 5 pour l'algorithme d'origine) en points [lon, lat]. */
export function decodePolyline(encoded: string, precision = 6): LonLat[] {
  const factor = 10 ** precision;
  const points: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = next();
    const dLon = next();
    if (dLat === null || dLon === null) break; // polyline tronquée : on garde ce qui est lisible
    lat += dLat;
    lon += dLon;
    points.push([lon / factor, lat / factor]);
  }
  return points;
}

/** Encode des points [lon, lat] en polyline Google (tests et faux MOTIS du monde fictif). */
export function encodePolyline(points: LonLat[], precision = 6): string {
  const factor = 10 ** precision;
  let out = '';
  let prevLat = 0;
  let prevLon = 0;
  const put = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of points) {
    const iLat = Math.round(lat * factor);
    const iLon = Math.round(lon * factor);
    put(iLat - prevLat);
    put(iLon - prevLon);
    prevLat = iLat;
    prevLon = iLon;
  }
  return out;
}

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_EQ = 111_320;

/** Plan local autour d'une latitude : coordonnées en mètres. */
function planar(lat0: number) {
  const kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  return (p: LonLat): [number, number] => [p[0] * kx, p[1] * M_PER_DEG_LAT];
}

const toLonLat = (p: LatLon): LonLat => [p.lon, p.lat];

/** Longueurs cumulées le long du tracé, en mètres (la première vaut 0). */
export function cumulativeLengths(path: LonLat[]): number[] {
  if (path.length === 0) return [];
  const xy = planar(path[0][1]);
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = xy(path[i - 1]);
    const [bx, by] = xy(path[i]);
    out.push(out[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  return out;
}

/** Projection d'un point sur un tracé : distance le long du tracé, et écart au tracé, en mètres. */
export type Projection = { along: number; offset: number; segment: number };

/**
 * Projette `point` sur le tracé, sans revenir avant `minAlong` mètres (les arrêts d'une course se projettent dans
 * l'ordre : un tracé qui repasse près d'un arrêt déjà vu ne le fait pas reculer).
 */
export function project(path: LonLat[], point: LatLon, minAlong = 0, lengths = cumulativeLengths(path)): Projection {
  if (path.length === 0) return { along: 0, offset: Number.POSITIVE_INFINITY, segment: 0 };
  const xy = planar(path[0][1]);
  const [px, py] = xy(toLonLat(point));
  if (path.length === 1) {
    const [ax, ay] = xy(path[0]);
    return { along: 0, offset: Math.hypot(px - ax, py - ay), segment: 0 };
  }
  let best: Projection = { along: 0, offset: Number.POSITIVE_INFINITY, segment: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    if (lengths[i + 1] < minAlong && i < path.length - 2) continue;
    const [ax, ay] = xy(path[i]);
    const [bx, by] = xy(path[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const span = lengths[i + 1] - lengths[i];
    const tMin = span > 0 ? Math.max(0, Math.min(1, (minAlong - lengths[i]) / span)) : 0;
    const t = len2 === 0 ? 0 : Math.max(tMin, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const offset = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (offset < best.offset) best = { along: lengths[i] + t * (lengths[i + 1] - lengths[i]), offset, segment: i };
  }
  return best;
}

/** Écart d'un point au tracé, en mètres (infini sans tracé). */
export const distanceToPath = (path: LonLat[], point: LatLon) => project(path, point).offset;

/** Distances le long du tracé des arrêts d'une course, dans l'ordre (jamais en arrière). */
export function projectStops(path: LonLat[], stops: LatLon[]): number[] {
  const lengths = cumulativeLengths(path);
  let last = 0;
  return stops.map((stop) => {
    last = Math.max(last, project(path, stop, last, lengths).along);
    return last;
  });
}

/** Point du tracé à `along` mètres du début (borné aux extrémités). */
export function pointAt(path: LonLat[], along: number, lengths = cumulativeLengths(path)): LonLat | null {
  if (path.length === 0) return null;
  if (along <= 0) return path[0];
  const total = lengths[lengths.length - 1];
  if (along >= total) return path[path.length - 1];
  let i = 1;
  while (lengths[i] < along) i++;
  const span = lengths[i] - lengths[i - 1];
  const t = span === 0 ? 0 : (along - lengths[i - 1]) / span;
  const [ax, ay] = path[i - 1];
  const [bx, by] = path[i];
  return [ax + t * (bx - ax), ay + t * (by - ay)];
}
