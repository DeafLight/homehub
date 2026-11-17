// Tests de la carte en route : étapes (attente ajoutée avant une course sans marche), avance automatique (arrêt,
// vitesse, sauts du GPS, descente, arrivée) et par le bouton, textes du panneau, fusion des nouvelles heures.
import { describe, expect, it } from 'vitest';
import type { RouteCourse, RouteLeg, RoutePlace, TripRoute } from '../../../shared/trip.ts';
import { advance, boarded, type Fix, headline, manualNext, mergeRides, nextLabel, rideRefs, START, stepRows, stepsOf, walkDistance } from './en-route.ts';

const T0 = new Date(2026, 10, 5, 7, 40).getTime();
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const P: RoutePlace = { name: 'START', lat: 47.4655, lon: -0.5585 };
const R: RoutePlace = { name: 'Ralliement', lat: 47.4668, lon: -0.557, stopId: 'irigo_RALL' };
const T: RoutePlace = { name: 'Mail des Tilleuls', lat: 47.474, lon: -0.547, stopId: 'irigo_TILL' };
const TA: RoutePlace = { ...T, lat: 47.4742, lon: -0.5466, stopId: 'irigo_TILL-A' };
const C: RoutePlace = { name: 'Les Collèges', lat: 47.4785, lon: -0.5505, stopId: 'irigo_COLL' };
const D: RoutePlace = { name: 'END', lat: 47.48, lon: -0.55 };
const line = (a: RoutePlace, b: RoutePlace): [number, number][] => [[a.lon, a.lat], [b.lon, b.lat]];

function leg(mode: RouteLeg['mode'], from: RoutePlace, to: RoutePlace, departs: number, arrives: number, extra: Partial<RouteLeg> = {}): RouteLeg {
  return { mode, from, to, departs: at(departs), arrives: at(arrives), scheduledDeparts: at(departs), scheduledArrives: at(arrives), path: line(from, to), ...extra };
}
const course = (stops: RoutePlace[], board: number, alight: number): RouteCourse => ({ path: stops.map((s) => [s.lon, s.lat]), stops, board, alight });

const ROUTE: TripRoute = {
  destination: { kind: 'course', title: 'Maths', start: at(30), place: 'Collège', lat: D.lat, lon: D.lon },
  arriveBy: at(20),
  late: false,
  legs: [
    leg('walk', P, R, 0, 4),
    leg('bus', R, T, 4, 16, { line: '3', headsign: 'Lycée', tripId: 'bus', delayMinutes: 1, course: course([R, T], 0, 1) }),
    leg('walk', T, TA, 16, 18),
    leg('tram', TA, C, 20, 28, { line: 'A', headsign: 'Verneau', tripId: 'tram', course: course([TA, C], 0, 1) }),
    leg('walk', C, D, 28, 31),
  ],
};
const steps = stepsOf(ROUTE);

/** Position `meters` au nord de `p`. */
const north = (p: RoutePlace, meters: number) => ({ lat: p.lat + meters / 110_540, lon: p.lon });
const fix = (p: { lat: number; lon: number }, seconds: number, accuracy = 10): Fix => ({ ...p, accuracy, at: T0 + seconds * 1000 });
/** Positions successives le long d'un segment, `speed` m/s, une par seconde. */
function along(a: RoutePlace, b: RoutePlace, speed: number, start: number, count: number): Fix[] {
  const meters = Math.hypot((b.lat - a.lat) * 110_540, (b.lon - a.lon) * 75_000);
  return Array.from({ length: count }, (_, i) => {
    const t = Math.min(1, (speed * i) / meters);
    return fix({ lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) }, start + i);
  });
}
const run = (fixes: Fix[], p = START) => fixes.reduce((acc, f) => advance(acc, steps, f), p);

describe('étapes', () => {
  it('une étape par mode ; une attente ajoutée avant une course sans marche avant', () => {
    expect(steps.map((s) => s.mode)).toEqual(['walk', 'bus', 'walk', 'tram', 'walk']);
    const direct = stepsOf({ ...ROUTE, legs: [ROUTE.legs[1], ROUTE.legs[3]] });
    expect(direct.map((s) => `${s.mode}${s.wait ? '…' : ''}`)).toEqual(['walk…', 'bus', 'walk…', 'tram']);
    expect(direct[2]).toMatchObject({ from: TA, to: TA, departs: at(16), arrives: at(20) });
  });

  it('suit les courses une fois monté seulement', () => {
    expect(boarded(steps, 0)).toBe(false);
    expect(boarded(steps, 2)).toBe(true);
    expect(rideRefs(steps, 0).map((r) => r.tripId)).toEqual(['bus', 'tram']);
    expect(rideRefs(steps, 2)).toEqual([{ tripId: 'tram', from: TA, to: C }]);
  });
});

describe('avance automatique', () => {
  it('monte dans le bus : passé à l’arrêt, puis deux positions rapides', () => {
    const atStop = run([fix(north(R, -100), 0), fix(north(R, -20), 60)]);
    expect(atStop).toMatchObject({ step: 0, nearStop: true });
    const riding = run(along(R, T, 9, 120, 4), atStop);
    expect(riding.step).toBe(1);
  });

  it('à pied, même rapide, loin de l’arrêt et du tracé : reste à pied', () => {
    expect(run(along(north(P, -500) as RoutePlace, north(P, -100) as RoutePlace, 6, 0, 6)).step).toBe(0);
  });

  it('tolère un saut du GPS isolé, accepte un saut confirmé', () => {
    const p = run([fix(P, 0), fix(north(P, 5000), 1)]);
    expect(p.last).toMatchObject({ lat: P.lat });
    expect(p.pending).not.toBeNull();
    const back = advance(p, steps, fix(north(P, 2), 2));
    expect(back.last?.lat).toBeCloseTo(north(P, 2).lat, 8);
    const confirmed = run([fix(P, 0), fix(north(P, 5000), 1), fix(north(P, 5010), 2)]);
    expect(confirmed.last?.lat).toBeCloseTo(north(P, 5010).lat, 8);
  });

  it('ignore une position imprécise', () => {
    expect(run([fix(P, 0, 200)]).last).toBeNull();
  });

  it('descend du bus : près de l’arrêt, au pas, deux fois de suite', () => {
    const inBus = { ...START, step: 1 };
    expect(run([fix(north(T, 300), 0), fix(north(T, 60), 30)], inBus).step).toBe(1);
    expect(run([fix(north(T, 300), 0), fix(north(T, 60), 30), fix(north(T, 58), 32), fix(north(T, 57), 34)], inBus).step).toBe(2);
  });

  it('arrive : à moins de 50 m de la destination', () => {
    expect(run([fix(north(D, 30), 0)], { ...START, step: 4 }).step).toBe(5);
  });

  it('le bouton passe à l’étape suivante, sans dépasser l’arrivée', () => {
    expect(manualNext({ ...START, nearStop: true, streak: 1 }, steps)).toMatchObject({ step: 1, nearStop: false, streak: 0 });
    expect(manualNext({ ...START, step: 5 }, steps).step).toBe(5);
  });
});

describe('panneau', () => {
  const now = new Date(T0 + 60_000);

  it('à pied vers l’arrêt : distance, minutes, et le bus qui arrive', () => {
    const h = headline(ROUTE, steps, START, north(R, -180), now);
    expect(h).toEqual({ icon: 'walk', title: 'Marche jusqu’à l’arrêt Ralliement', detail: '180 m · 3 min · le bus arrive dans 3 min' });
    expect(headline(ROUTE, steps, START, null, now).detail).toBe('4 min · le bus arrive dans 3 min');
    expect(nextLabel(steps, START)).toBe('Je suis dans le bus');
  });

  it('à l’arrêt, puis en correspondance', () => {
    expect(headline(ROUTE, steps, { ...START, nearStop: true }, R, now).title).toBe('Attends le bus 3 à l’arrêt Ralliement');
    expect(headline(ROUTE, steps, { ...START, step: 2 }, TA, new Date(T0 + 17 * 60_000))).toEqual({
      icon: 'tram',
      title: 'Correspondance : tram A à Mail des Tilleuls',
      detail: 'direction Verneau · le tram arrive dans 3 min',
    });
  });

  it('dans le bus : direction, arrêts, descente et retard', () => {
    const h = headline(ROUTE, steps, { ...START, step: 1 }, R, new Date(T0 + 6 * 60_000));
    expect(h).toEqual({ icon: 'bus', title: 'Bus 3 jusqu’à Mail des Tilleuls', detail: 'direction Lycée · 1 arrêt · descente dans 10 min · +1 min de retard' });
    expect(nextLabel(steps, { ...START, step: 1 })).toBe('J’ai quitté le bus');
  });

  it('dernière marche, puis arrivé', () => {
    expect(headline(ROUTE, steps, { ...START, step: 4 }, null, now).title).toBe('Marche jusqu’à Collège');
    expect(nextLabel(steps, { ...START, step: 4 })).toBe('Je suis sur place');
    expect(headline(ROUTE, steps, { ...START, step: 5 }, null, now)).toMatchObject({ icon: 'flag', title: 'Arrivée : Collège' });
    expect(nextLabel(steps, { ...START, step: 5 })).toBeNull();
  });

  it('liste horodatée : faites, en cours, à venir, retard, arrivée', () => {
    const rows = stepRows(ROUTE, steps, { ...START, step: 1 });
    expect(rows.map((r) => `${r.time} ${r.text} ${r.state}${r.delay ? ` ${r.delay}` : ''}`)).toEqual([
      '7 h 40 À pied jusqu’à Ralliement · 4 min done',
      '7 h 44 Bus 3 → Mail des Tilleuls current +1 min',
      '7 h 56 À pied jusqu’à Mail des Tilleuls · 2 min next',
      '8 h 00 Tram A → Les Collèges next',
      '8 h 08 À pied jusqu’à Collège · 3 min next',
      '8 h 11 Arrivée · Collège next',
    ]);
  });

  it('distances lisibles', () => {
    expect(walkDistance(3)).toBe('10 m');
    expect(walkDistance(184)).toBe('180 m');
    expect(walkDistance(1250)).toBe('1,3 km');
  });
});

describe('nouvelles heures', () => {
  it('remplace heures et retard des courses retrouvées, fait glisser les marches qui suivent', () => {
    const merged = mergeRides(ROUTE, [
      { tripId: 'bus', departs: at(7), arrives: at(19), scheduledDeparts: at(4), scheduledArrives: at(16), delayMinutes: 3, course: course([R, T], 0, 1) },
      null,
    ]);
    expect(merged.legs[1]).toMatchObject({ departs: at(7), arrives: at(19), delayMinutes: 3 });
    expect(merged.legs[2]).toMatchObject({ departs: at(19), arrives: at(21) });
    expect(merged.legs[3]).toEqual(ROUTE.legs[3]);
    expect(merged.legs[4]).toEqual(ROUTE.legs[4]);
    // Retard annulé : le champ disparaît.
    const onTime = mergeRides(ROUTE, [{ tripId: 'bus', departs: at(4), arrives: at(16), scheduledDeparts: at(4), scheduledArrives: at(16), course: course([R, T], 0, 1) }]);
    expect(onTime.legs[1]).not.toHaveProperty('delayMinutes');
  });
});
