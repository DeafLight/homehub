// Tests des tracés de la carte en route : polyline, longueurs, projections et point à une distance.
import { describe, expect, it } from 'vitest';
import { cumulativeLengths, decodePolyline, distanceToPath, encodePolyline, type LonLat, pointAt, project, projectStops } from './geo-path.ts';

describe('polyline', () => {
  it('décode l’exemple de Google (précision 5)', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it('encode puis décode à la précision 6 de MOTIS', () => {
    const points: LonLat[] = [[-0.5585, 47.4655], [-0.557, 47.4668], [-0.5469, 47.4741]];
    expect(decodePolyline(encodePolyline(points), 6)).toEqual(points);
  });

  it('garde ce qui est lisible d’une polyline tronquée', () => {
    const full = encodePolyline([[-0.55, 47.47], [-0.54, 47.48]]);
    expect(decodePolyline(full.slice(0, -2))).toEqual([[-0.55, 47.47]]);
    expect(decodePolyline('')).toEqual([]);
  });
});

// Un tracé en L : 1 km vers le nord, puis 1 km vers l'est (environ), à Angers.
const north = 1000 / 110_540;
const east = 1000 / (111_320 * Math.cos((47.47 * Math.PI) / 180));
const L: LonLat[] = [[-0.55, 47.47], [-0.55, 47.47 + north], [-0.55 + east, 47.47 + north]];

describe('longueurs et projections', () => {
  it('cumule les longueurs en mètres', () => {
    const lengths = cumulativeLengths(L);
    expect(lengths[0]).toBe(0);
    expect(lengths[1]).toBeCloseTo(1000, 0);
    expect(lengths[2]).toBeCloseTo(2000, -1);
  });

  it('projette un point à côté du tracé', () => {
    const p = project(L, { lat: 47.47 + north / 2, lon: -0.55 + east / 10 });
    expect(p.along).toBeCloseTo(500, -1);
    expect(p.offset).toBeCloseTo(100, -1);
    expect(distanceToPath(L, { lat: 47.47, lon: -0.55 })).toBeCloseTo(0, 3);
    expect(distanceToPath([], { lat: 47.47, lon: -0.55 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('projette les arrêts dans l’ordre, sans revenir en arrière', () => {
    // Un aller-retour : le troisième arrêt est au même endroit que le premier, mais au bout du tracé.
    const back: LonLat[] = [[-0.55, 47.47], [-0.55, 47.47 + north], [-0.55, 47.47]];
    const stops = projectStops(back, [{ lat: 47.47, lon: -0.55 }, { lat: 47.47 + north, lon: -0.55 }, { lat: 47.47, lon: -0.55 }]);
    expect(stops[0]).toBeCloseTo(0, 0);
    expect(stops[1]).toBeCloseTo(1000, 0);
    expect(stops[2]).toBeCloseTo(2000, -1);
  });

  it('trouve le point à une distance donnée, borné aux extrémités', () => {
    const mid = pointAt(L, 1500)!;
    expect(mid[1]).toBeCloseTo(47.47 + north, 6);
    expect(mid[0]).toBeCloseTo(-0.55 + east / 2, 5);
    expect(pointAt(L, -5)).toEqual(L[0]);
    expect(pointAt(L, 1e9)).toEqual(L[2]);
    expect(pointAt([], 10)).toBeNull();
  });
});
