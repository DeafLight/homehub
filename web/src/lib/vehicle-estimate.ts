// Véhicule à prendre sur la carte en route, en position estimée (les vraies positions GTFS-RT viendront avec la
// version 4) : interpolée sur le tracé de sa course d'après les heures de ses arrêts (temps réel compris quand MOTIS le
// connaît). À pied ou à l'arrêt : le prochain bus ou tram à prendre ; dans un véhicule : celui-ci et, s'il y a une
// correspondance, le suivant. Logique pure, testée à part (vehicle-estimate.test.ts).
import { type LonLat, pointAt, projectStops } from '../../../shared/geo-path.ts';
import type { RouteCourse, TripLegMode } from '../../../shared/trip.ts';
import { durationText } from './next-trip.ts';
import { minutesUntil, type Step, vehicleName } from './en-route.ts';

/** Position estimée d'une course à l'instant `now` (ms) : à un arrêt ou entre deux ; null une fois arrivée au terminus. */
export function vehiclePosition(course: RouteCourse, now: number): LonLat | null {
  const timed = course.stops
    .map((s) => ({ s, arr: Date.parse(s.arrives ?? s.departs ?? ''), dep: Date.parse(s.departs ?? s.arrives ?? '') }))
    .filter((t) => Number.isFinite(t.arr) && Number.isFinite(t.dep));
  if (timed.length === 0) return null;
  const path: LonLat[] = course.path.length >= 2 ? course.path : timed.map(({ s }) => [s.lon, s.lat]);
  const along = projectStops(path, timed.map(({ s }) => s));
  if (now > timed[timed.length - 1].arr) return null;
  if (now <= timed[0].dep) return pointAt(path, along[0]);
  for (let i = 0; i < timed.length - 1; i++) {
    if (now <= timed[i].dep) return pointAt(path, along[i]); // à l'arrêt
    if (now <= timed[i + 1].arr) {
      const span = timed[i + 1].arr - timed[i].dep;
      const t = span > 0 ? (now - timed[i].dep) / span : 1;
      return pointAt(path, along[i] + t * (along[i + 1] - along[i]));
    }
  }
  return pointAt(path, along[along.length - 1]);
}

export type VehicleMark = { lon: number; lat: number; mode: TripLegMode; line: string; label: string; /** Le véhicule où l'on est. */ current: boolean };

/** « tram A · à l'arrêt dans 5 min » (ou « à l'arrêt » une fois l'heure passée). */
const approach = (step: Step, now: Date) => {
  const n = minutesUntil(step.departs, now);
  return `${vehicleName(step)} · ${n <= 0 ? 'à l’arrêt' : `à l’arrêt dans ${durationText(n)}`}`;
};

/** Véhicules à montrer à l'étape `index` : le prochain à prendre, ou celui où l'on est et le suivant. */
export function vehiclesToShow(steps: Step[], index: number, now: Date): VehicleMark[] {
  const step = steps[index];
  if (!step) return [];
  const rides = steps.map((s, i) => ({ s, i })).filter(({ s, i }) => s.mode !== 'walk' && i >= index);
  const wanted: { s: Step; current: boolean }[] = [];
  if (step.mode === 'walk') {
    if (rides[0]) wanted.push({ s: rides[0].s, current: false });
  } else {
    wanted.push({ s: step, current: true });
    if (rides[1]) wanted.push({ s: rides[1].s, current: false });
  }
  return wanted.flatMap(({ s, current }) => {
    const at = s.course ? vehiclePosition(s.course, now.getTime()) : null;
    if (!at) return [];
    // Le véhicule où l'on est : son nom seul (la descente est dite en gros dans le panneau).
    const label = current ? vehicleName(s) : approach(s, now);
    return [{ lon: at[0], lat: at[1], mode: s.mode, line: s.line ?? '', label, current }];
  });
}
