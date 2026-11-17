// Tests de la mise en forme de la carte en route : course entière, arrêts de montée et de descente retrouvés par
// identifiant, nom ou proximité, courses enchaînées, course incohérente écartée.
import { describe, expect, it } from 'vitest';
import { encodePolyline } from '../../shared/geo-path.ts';
import type { MotisItinerary, MotisLeg, MotisStop } from '../sources/motis.ts';
import { courseOf } from './trip-route.ts';

const stop = (name: string, lat: number, extra: Partial<MotisStop> = {}): MotisStop => ({ name, lat, lon: -0.55, stopId: `irigo_${name}`, ...extra });
const leg = (stops: MotisStop[]): MotisLeg => ({
  mode: 'TRAM',
  line: 'A',
  from: stops[0],
  to: stops.at(-1)!,
  departs: '2026-11-05T07:00:00.000Z',
  arrives: '2026-11-05T07:10:00.000Z',
  scheduledDeparts: '2026-11-05T07:00:00.000Z',
  scheduledArrives: '2026-11-05T07:10:00.000Z',
  realtime: false,
  cancelled: false,
  geometry: { points: encodePolyline(stops.map((s) => [s.lon, s.lat])), precision: 6 },
  stops,
});
const trip = (...legs: MotisLeg[]): MotisItinerary => ({ departs: legs[0].departs, arrives: legs.at(-1)!.arrives, transfers: 0, legs });

describe('courseOf', () => {
  const stops = [stop('A', 47.47), stop('B', 47.472), stop('C', 47.474), stop('D', 47.476)];

  it('repère montée et descente par identifiant, garde le tracé', () => {
    const course = courseOf(trip(leg(stops)), { name: 'autre nom', lat: 0, lon: 0, stopId: 'irigo_B' }, { name: 'D', lat: 47.476, lon: -0.55, stopId: 'irigo_D' });
    expect(course).toMatchObject({ board: 1, alight: 3 });
    expect(course?.path).toHaveLength(4);
  });

  it('sinon par nom, sinon l’arrêt le plus proche', () => {
    expect(courseOf(trip(leg(stops)), { name: 'B', lat: 0, lon: 0 }, { name: '?', lat: 47.4741, lon: -0.55 })).toMatchObject({ board: 1, alight: 2 });
  });

  it('courses enchaînées : l’arrêt de jonction une seule fois', () => {
    const course = courseOf(trip(leg(stops.slice(0, 3)), leg(stops.slice(2))), { name: 'A', lat: 47.47, lon: -0.55 }, { name: 'D', lat: 47.476, lon: -0.55 });
    expect(course?.stops.map((s) => s.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(course).toMatchObject({ board: 0, alight: 3 });
  });

  it('descente avant la montée, ou course sans arrêts : rien', () => {
    expect(courseOf(trip(leg(stops)), { name: 'D', lat: 47.476, lon: -0.55 }, { name: 'A', lat: 47.47, lon: -0.55, stopId: 'irigo_A' })).toBeNull();
    expect(courseOf(trip({ ...leg(stops), stops: [] }), stops[0], stops[1])).toBeNull();
  });
});
