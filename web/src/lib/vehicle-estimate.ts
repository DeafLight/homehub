// Véhicule à prendre sur la carte en route. À pied ou à l'arrêt : le prochain bus ou tram à prendre ; dans un
// véhicule : celui-ci et, s'il y a une correspondance, le suivant. À sa position réelle quand le flux VehiclePositions
// la donne et qu'elle est fraîche (version 4, vehicle-real.ts), sinon en position estimée : interpolée sur le tracé de
// sa course d'après les heures de ses arrêts (temps réel compris quand MOTIS le connaît). Logique pure, testée à part
// (vehicle-estimate.test.ts).
import { type LonLat, pointAt, projectStops } from '../../../shared/geo-path.ts';
import type { RouteCourse, TripLegMode } from '../../../shared/trip.ts';
import { durationText } from './next-trip.ts';
import { minutesUntil, type Step, vehicleName } from './en-route.ts';
import { realPosition, stopsAway, stopsText, type TrackedVehicles } from './vehicle-real.ts';

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

export type VehicleMark = {
  lon: number;
  lat: number;
  mode: TripLegMode;
  line: string;
  label: string;
  /** Le véhicule où l'on est. */
  current: boolean;
  /** Position réelle (icône pleine) ; sinon estimée (icône creuse). */
  real: boolean;
  /** Cap du véhicule en degrés, s'il est connu (position réelle). */
  bearing?: number;
};

/** « tram A · à l'arrêt dans 5 min » (ou « à l'arrêt » une fois l'heure passée). */
const approach = (step: Step, now: Date) => {
  const n = minutesUntil(step.departs, now);
  return `${vehicleName(step)} · ${n <= 0 ? 'à l’arrêt' : `à l’arrêt dans ${durationText(n)}`}`;
};

/** Courses à montrer à l'étape `index` : le prochain véhicule à prendre, ou celui où l'on est et le suivant. */
function wanted(steps: Step[], index: number): { s: Step; current: boolean }[] {
  const step = steps[index];
  if (!step) return [];
  const rides = steps.filter((s, i) => s.mode !== 'walk' && i >= index);
  if (step.mode === 'walk') return rides[0] ? [{ s: rides[0], current: false }] : [];
  return [{ s: step, current: true }, ...(rides[1] ? [{ s: rides[1], current: false }] : [])];
}

/** Courses MOTIS dont on demande la position réelle à l'étape `index`. */
export const wantedTrips = (steps: Step[], index: number) => wanted(steps, index).flatMap(({ s }) => (s.tripId ? [s.tripId] : []));

/**
 * Véhicules à montrer à l'étape `index` : le prochain à prendre, ou celui où l'on est et le suivant ; à leur position
 * réelle si `tracked` en a une de fraîche, sinon estimée.
 */
export function vehiclesToShow(steps: Step[], index: number, now: Date, tracked: TrackedVehicles = new Map()): VehicleMark[] {
  return wanted(steps, index).flatMap(({ s, current }): VehicleMark[] => {
    const real = realPosition(tracked, s.tripId, s.course);
    if (real) {
      // Le véhicule où l'on est : son nom seul ; celui à prendre : à combien d'arrêts de la montée.
      const label = current || !s.course ? vehicleName(s) : `${vehicleName(s)} · ${stopsText(stopsAway(s.course, real))}`;
      return [{ lon: real.lon, lat: real.lat, mode: s.mode, line: s.line ?? '', label, current, real: true, ...(real.bearing !== undefined && { bearing: real.bearing }) }];
    }
    const at = s.course ? vehiclePosition(s.course, now.getTime()) : null;
    if (!at) return [];
    // Le véhicule où l'on est : son nom seul (la descente est dite en gros dans le panneau).
    const label = current ? vehicleName(s) : approach(s, now);
    return [{ lon: at[0], lat: at[1], mode: s.mode, line: s.line ?? '', label, current, real: false }];
  });
}
