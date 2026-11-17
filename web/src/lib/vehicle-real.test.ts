// Tests des positions réelles : âge (serveur + temps écoulé), bascule réelle / estimée avec marge (sans clignoter),
// course absente d'une réponse, courses oubliées, position loin du tracé écartée, « à N arrêts » d'après l'arrêt du
// flux ou la projection sur le tracé ; et leur place dans vehiclesToShow (icône pleine, libellé).
import { describe, expect, it } from 'vitest';
import type { RouteCourse, RouteLeg, RouteStop, VehicleFix } from '../../../shared/trip.ts';
import { stepsOf } from './en-route.ts';
import { vehiclesToShow, wantedTrips } from './vehicle-estimate.ts';
import { ageOf, ENTER_AGE_S, LEAVE_AGE_S, realPosition, stopsAway, stopsText, track, type TrackedVehicles } from './vehicle-real.ts';

const T0 = new Date(2026, 10, 5, 7, 40).getTime();
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
// Cinq arrêts à 500 m d'écart vers le nord, une minute entre deux ; montée au quatrième (D).
const STEP = 500 / 110_540;
const STOPS: RouteStop[] = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ name, stopId: `irigo_${name}`, lat: 47.47 + i * STEP, lon: -0.55, arrives: at(i), departs: at(i) }));
const COURSE: RouteCourse = { path: STOPS.map((s) => [s.lon, s.lat]), stops: STOPS, board: 3, alight: 4 };
const fix = (over: Partial<VehicleFix> = {}): VehicleFix => ({ tripId: 'T', lat: STOPS[1].lat, lon: -0.55, age: 10, ...over });

describe('track : réelle ou estimée', () => {
  it('âge : celui du serveur plus le temps écoulé depuis la réception', () => {
    const tracked = track(new Map(), [fix({ age: 20 })], T0, ['T']);
    expect(ageOf(tracked.get('T')!, T0 + 30_000)).toBe(50);
  });

  it('passe à la réelle sous 90 s, y reste jusqu’à 2 min, puis revient à l’estimée', () => {
    let tracked = track(new Map(), [fix({ age: 30 })], T0, ['T']);
    expect(tracked.get('T')!.real).toBe(true);
    tracked = track(tracked, [], T0 + (LEAVE_AGE_S - 30) * 1000, ['T']);
    expect(tracked.get('T')!.real).toBe(true);
    tracked = track(tracked, [], T0 + (LEAVE_AGE_S - 30 + 1) * 1000, ['T']);
    expect(tracked.get('T')!.real).toBe(false);
  });

  it('sans clignoter : une position entre 90 s et 2 min ne fait pas repasser à la réelle', () => {
    let tracked = track(new Map(), [fix({ age: ENTER_AGE_S + 10 })], T0, ['T']);
    expect(tracked.get('T')!.real).toBe(false);
    tracked = track(tracked, [fix({ age: ENTER_AGE_S + 5 })], T0 + 20_000, ['T']);
    expect(tracked.get('T')!.real).toBe(false);
    tracked = track(tracked, [fix({ age: 15 })], T0 + 40_000, ['T']);
    expect(tracked.get('T')!.real).toBe(true);
  });

  it('course absente d’une réponse : sa dernière position vieillit ; une plus vieille ne remplace pas la récente', () => {
    let tracked = track(new Map(), [fix({ age: 5, lat: 1 })], T0, ['T']);
    tracked = track(tracked, [], T0 + 20_000, ['T']);
    expect(tracked.get('T')!.fix.lat).toBe(1);
    tracked = track(tracked, [fix({ age: 60, lat: 2 })], T0 + 25_000, ['T']);
    expect(tracked.get('T')!.fix.lat).toBe(1);
  });

  it('course qui n’est plus suivie, ou position de plus de 10 min : oubliée', () => {
    const tracked = track(new Map(), [fix(), fix({ tripId: 'U', age: 700 })], T0, ['T', 'U']);
    expect([...tracked.keys()]).toEqual(['T']);
    expect(track(tracked, [], T0, ['V']).size).toBe(0);
  });
});

describe('realPosition', () => {
  const tracked: TrackedVehicles = track(new Map(), [fix()], T0, ['T']);

  it('position réelle près du tracé ; course inconnue : rien', () => {
    expect(realPosition(tracked, 'T', COURSE)?.lat).toBe(STOPS[1].lat);
    expect(realPosition(tracked, 'X', COURSE)).toBeNull();
    expect(realPosition(tracked, undefined, COURSE)).toBeNull();
  });

  it('à plus de 300 m du tracé : pas crue', () => {
    const far = track(new Map(), [fix({ lon: -0.55 + 400 / 75_000 })], T0, ['T']);
    expect(realPosition(far, 'T', COURSE)).toBeNull();
  });
});

describe('stopsAway', () => {
  it('d’après l’arrêt du flux : à l’arrêt, ou en route vers lui', () => {
    expect(stopsAway(COURSE, fix({ stopId: 'B', status: 'stopped' }))).toBe(2);
    expect(stopsAway(COURSE, fix({ stopId: 'C', status: 'in-transit' }))).toBe(2);
    expect(stopsAway(COURSE, fix({ stopId: 'D', status: 'incoming' }))).toBe(1);
    expect(stopsAway(COURSE, fix({ stopId: 'D', status: 'stopped' }))).toBe(0);
    expect(stopsAway(COURSE, fix({ stopId: 'E', status: 'stopped' }))).toBe(-1);
  });

  it('sans arrêt (ou arrêt inconnu) : projection sur le tracé', () => {
    expect(stopsAway(COURSE, fix({ lat: STOPS[1].lat }))).toBe(2);
    expect(stopsAway(COURSE, fix({ lat: STOPS[1].lat + STEP / 2, stopId: 'ZZZ' }))).toBe(2);
    expect(stopsAway(COURSE, fix({ lat: STOPS[3].lat + 10 / 110_540 }))).toBe(0);
    expect(stopsAway(COURSE, fix({ lat: STOPS[4].lat + 5 * STEP }))).toBe(-1);
  });

  it('libellés', () => {
    expect([0, 1, 2, -1].map(stopsText)).toEqual(['à l’arrêt', 'à 1 arrêt', 'à 2 arrêts', 'déjà passé']);
  });
});

describe('vehiclesToShow avec positions réelles', () => {
  const place = (s: RouteStop) => ({ name: s.name, lat: s.lat, lon: s.lon, stopId: s.stopId });
  const ride = (mode: RouteLeg['mode'], line: string, tripId: string, board: number, alight: number): RouteLeg => ({
    mode,
    line,
    tripId,
    from: place(STOPS[board]),
    to: place(STOPS[alight]),
    departs: STOPS[board].departs!,
    arrives: STOPS[alight].arrives!,
    scheduledDeparts: STOPS[board].departs!,
    scheduledArrives: STOPS[alight].arrives!,
    path: [],
    course: { ...COURSE, board, alight },
  });
  const walk: RouteLeg = { mode: 'walk', from: place(STOPS[0]), to: place(STOPS[3]), departs: at(-5), arrives: at(3), scheduledDeparts: at(-5), scheduledArrives: at(3), path: [] };
  const steps = stepsOf({ destination: { kind: 'event', title: 'X', start: at(30), place: 'Ici', lat: 0, lon: 0 }, arriveBy: at(25), late: false, legs: [walk, ride('tram', 'A', 'TA', 3, 4)] });

  it('à pied : le tram à prendre à sa vraie position, icône pleine, « à 2 arrêts »', () => {
    expect(wantedTrips(steps, 0)).toEqual(['TA']);
    const tracked = track(new Map(), [fix({ tripId: 'TA', bearing: 0, stopId: 'B', status: 'stopped' })], T0, ['TA']);
    expect(vehiclesToShow(steps, 0, new Date(T0), tracked)).toEqual([
      { lon: -0.55, lat: STOPS[1].lat, mode: 'tram', line: 'A', label: 'tram A · à 2 arrêts', current: false, real: true, bearing: 0 },
    ]);
  });

  it('position trop vieille : retour à l’estimée, icône creuse', () => {
    const tracked = track(new Map(), [fix({ tripId: 'TA' })], T0, ['TA']);
    const later = track(tracked, [], T0 + 3 * 60_000, ['TA']);
    expect(vehiclesToShow(steps, 0, new Date(T0 + 3 * 60_000), later)[0]).toMatchObject({ real: false, label: 'tram A · à l’arrêt' });
  });

  it('dans le tram : son nom seul, à sa vraie position', () => {
    const tracked = track(new Map(), [fix({ tripId: 'TA', lat: STOPS[3].lat })], T0, ['TA']);
    expect(vehiclesToShow(steps, 1, new Date(T0), tracked)[0]).toMatchObject({ real: true, current: true, label: 'tram A' });
  });
});
