// Tests du véhicule estimé : position interpolée entre deux arrêts d'après leurs heures, arrêt marqué, terminus,
// tracé absent ; quels véhicules montrer à pied et dans un véhicule avec correspondance.
import { describe, expect, it } from 'vitest';
import type { RouteCourse, RouteLeg, RouteStop } from '../../../shared/trip.ts';
import { stepsOf } from './en-route.ts';
import { vehiclePosition, vehiclesToShow } from './vehicle-estimate.ts';

const T0 = new Date(2026, 10, 5, 7, 40).getTime();
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const stop = (name: string, lat: number, arr: number, dep = arr): RouteStop => ({ name, lat, lon: -0.55, arrives: at(arr), departs: at(dep) });
// Trois arrêts à 1 km d'écart vers le nord ; arrêt d'une minute au deuxième.
const KM = 1000 / 110_540;
const STOPS = [stop('A', 47.47, 0), stop('B', 47.47 + KM, 4, 5), stop('C', 47.47 + 2 * KM, 9)];
const COURSE: RouteCourse = { path: STOPS.map((s) => [s.lon, s.lat]), stops: STOPS, board: 0, alight: 2 };

describe('vehiclePosition', () => {
  it('au départ avant l’heure, interpolé entre deux arrêts, à l’arrêt pendant l’arrêt', () => {
    expect(vehiclePosition(COURSE, T0 - 60_000)?.[1]).toBeCloseTo(47.47, 6);
    expect(vehiclePosition(COURSE, T0 + 2 * 60_000)?.[1]).toBeCloseTo(47.47 + KM / 2, 6);
    expect(vehiclePosition(COURSE, T0 + 4.5 * 60_000)?.[1]).toBeCloseTo(47.47 + KM, 6);
    expect(vehiclePosition(COURSE, T0 + 7 * 60_000)?.[1]).toBeCloseTo(47.47 + 1.5 * KM, 6);
  });

  it('plus rien après le terminus ; sans tracé, en ligne droite entre les arrêts', () => {
    expect(vehiclePosition(COURSE, T0 + 10 * 60_000)).toBeNull();
    expect(vehiclePosition({ ...COURSE, path: [] }, T0 + 2 * 60_000)?.[1]).toBeCloseTo(47.47 + KM / 2, 6);
    expect(vehiclePosition({ ...COURSE, stops: [{ name: 'X', lat: 0, lon: 0 }] }, T0)).toBeNull();
  });
});

describe('vehiclesToShow', () => {
  const place = (s: RouteStop) => ({ name: s.name, lat: s.lat, lon: s.lon });
  const ride = (mode: RouteLeg['mode'], line: string, board: number, alight: number): RouteLeg => ({
    mode,
    line,
    from: place(STOPS[board]),
    to: place(STOPS[alight]),
    departs: STOPS[board].departs!,
    arrives: STOPS[alight].arrives!,
    scheduledDeparts: STOPS[board].departs!,
    scheduledArrives: STOPS[alight].arrives!,
    path: [],
    course: { ...COURSE, board, alight },
  });
  const walk: RouteLeg = { mode: 'walk', from: place(STOPS[0]), to: place(STOPS[0]), departs: at(-5), arrives: at(0), scheduledDeparts: at(-5), scheduledArrives: at(0), path: [] };
  // Tram puis bus sur la même fausse course (heures décalées pour le bus).
  const steps = stepsOf({ destination: { kind: 'event', title: 'X', start: at(30), place: 'Ici', lat: 0, lon: 0 }, arriveBy: at(25), late: false, legs: [walk, ride('tram', 'A', 0, 1), ride('bus', '3', 1, 2)] });

  it('à pied : le prochain véhicule à prendre, « à l’arrêt dans … »', () => {
    const marks = vehiclesToShow(steps, 0, new Date(T0 - 5 * 60_000));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ line: 'A', mode: 'tram', current: false, label: 'tram A · à l’arrêt dans 5 min' });
  });

  it('dans le tram avec correspondance : le tram et le bus suivant', () => {
    const marks = vehiclesToShow(steps, 1, new Date(T0 + 2 * 60_000));
    expect(marks.map((m) => [m.line, m.current, m.label])).toEqual([
      ['A', true, 'tram A'],
      ['3', false, 'bus 3 · à l’arrêt dans 3 min'],
    ]);
  });

  it('arrivé : aucun véhicule', () => {
    expect(vehiclesToShow(steps, steps.length, new Date(T0))).toEqual([]);
  });
});
