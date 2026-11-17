// Positions réelles des véhicules sur la carte en route (chantier « Prochain trajet », version 4) : on retient la
// dernière position reçue de chaque course suivie, on juge son âge (celui que donne le serveur, plus le temps écoulé
// depuis la réception : l'horloge du téléphone peut être décalée), et l'on bascule entre position réelle et position
// estimée avec une marge, pour ne pas clignoter entre les deux quand le flux traîne. Aussi « à 2 arrêts », d'après
// l'arrêt courant ou suivant du flux, sinon la projection sur le tracé. Logique pure, testée à part (vehicle-real.test.ts).
import { type LonLat, project, projectStops } from '../../../shared/geo-path.ts';
import { feedLocalId, type RouteCourse, type VehicleFix } from '../../../shared/trip.ts';

/** On passe à la position réelle si elle a moins de 90 s… */
export const ENTER_AGE_S = 90;
/** … et l'on y reste tant qu'elle a moins de 2 min ; au-delà, retour à la position estimée. */
export const LEAVE_AGE_S = 120;
/** Une position à plus de 300 m du tracé de la course n'est pas crue (véhicule mal rattaché). */
export const MAX_OFF_PATH_M = 300;
/** Sans arrêt dans le flux : à moins de 30 m d'un arrêt (le long du tracé), le véhicule y est. */
export const AT_STOP_M = 30;
/** Rafraîchissement des positions tant que la carte est ouverte. */
export const VEHICLES_REFRESH_MS = 20_000;

/** Dernière position reçue d'une course, l'heure de réception (ms, horloge du téléphone) et le mode retenu. */
export type Tracked = { fix: VehicleFix; receivedAt: number; real: boolean };
export type TrackedVehicles = Map<string, Tracked>;

/** Âge d'une position, en secondes, à l'instant `now` (ms). */
export const ageOf = (t: Tracked, now: number) => t.fix.age + Math.max(0, now - t.receivedAt) / 1000;

/** Réelle ou estimée : le seuil dépend du mode en cours (90 s pour passer à la réelle, 2 min pour la quitter). */
const judge = (t: Tracked, now: number, wasReal: boolean) => ageOf(t, now) <= (wasReal ? LEAVE_AGE_S : ENTER_AGE_S);

/**
 * Met à jour les courses suivies avec les positions reçues (`fixes`, vide pour un simple passage du temps) : une
 * position plus récente remplace l'ancienne ; une course absente de la réponse garde la sienne, qui vieillit ; les
 * courses qui ne sont plus suivies (`wanted`) sont oubliées. Le mode de chaque course est réévalué à `now`.
 */
export function track(prev: TrackedVehicles, fixes: VehicleFix[], now: number, wanted: string[]): TrackedVehicles {
  const next: TrackedVehicles = new Map();
  const received = new Map(fixes.map((f) => [f.tripId, f]));
  for (const tripId of new Set(wanted)) {
    const old = prev.get(tripId);
    const fix = received.get(tripId);
    // La nouvelle position remplace l'ancienne si elle n'est pas plus vieille qu'elle (le flux peut répéter la même).
    const fresh = fix && (!old || fix.age <= ageOf(old, now)) ? { fix, receivedAt: now } : old && { fix: old.fix, receivedAt: old.receivedAt };
    if (!fresh) continue;
    const t: Tracked = { ...fresh, real: false };
    t.real = judge(t, now, old?.real ?? false);
    // Trop vieille pour jamais revenir : oubliée.
    if (ageOf(t, now) > 10 * 60) continue;
    next.set(tripId, t);
  }
  return next;
}

/** Position réelle à afficher pour cette course, ou null (estimée) : retenue comme réelle et près du tracé. */
export function realPosition(tracked: TrackedVehicles, tripId: string | undefined, course: RouteCourse | undefined): VehicleFix | null {
  const t = tripId ? tracked.get(tripId) : undefined;
  if (!t?.real) return null;
  if (course) {
    const path = pathOf(course);
    if (path.length >= 2 && project(path, t.fix).offset > MAX_OFF_PATH_M) return null;
  }
  return t.fix;
}

const pathOf = (course: RouteCourse): LonLat[] => (course.path.length >= 2 ? course.path : course.stops.map((s) => [s.lon, s.lat] as LonLat));

/**
 * Arrêts qui séparent le véhicule de l'arrêt de montée : 0 il y est, 1 c'est son prochain arrêt ; négatif : déjà passé.
 * D'après l'arrêt du flux (à l'arrêt, ou en route vers lui), sinon d'après sa position projetée sur le tracé.
 */
export function stopsAway(course: RouteCourse, fix: VehicleFix): number {
  const byId = fix.stopId ? course.stops.findIndex((s) => s.stopId !== undefined && feedLocalId(s.stopId) === fix.stopId) : -1;
  if (byId >= 0) return course.board - byId + (fix.status === 'stopped' ? 0 : 1);
  const path = pathOf(course);
  const along = projectStops(path, course.stops);
  const at = project(path, fix).along;
  const k = along.findIndex((a) => a >= at - AT_STOP_M);
  if (k < 0) return course.board - course.stops.length;
  return course.board - k + (Math.abs(along[k] - at) <= AT_STOP_M ? 0 : 1);
}

/** « à l'arrêt », « à 1 arrêt », « à 3 arrêts », « déjà passé ». */
export function stopsText(n: number): string {
  if (n < 0) return 'déjà passé';
  if (n === 0) return 'à l’arrêt';
  return `à ${n} arrêt${n > 1 ? 's' : ''}`;
}
