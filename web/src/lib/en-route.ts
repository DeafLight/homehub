// Carte en route (chantier « Prochain trajet », version 3) : les étapes du trajet suivi (chaque changement de mode en
// est une : marche ou attente jusqu'à l'arrêt, montée, correspondance, descente), l'avance d'une étape à la suivante
// d'après la position (proximité de l'arrêt et vitesse, en tolérant les sauts du GPS) ou le bouton, les textes du
// panneau (étape en cours, liste horodatée, bouton) et la fusion des nouvelles heures des courses suivies. Logique
// pure, testée à part (en-route.test.ts) ; l'écran (screens/EnRoute.svelte) affiche et la carte dessine.
import { distanceToPath } from '../../../shared/geo-path.ts';
import { distanceMeters, type LatLon, type RideRef, type RideUpdate, type RouteLeg, type TripLegMode, type TripRoute } from '../../../shared/trip.ts';
import { durationText, hourText } from './next-trip.ts';

/** Étape affichée : une étape de MOTIS, ou une attente à l'arrêt ajoutée avant une course qui n'a pas de marche avant. */
export type Step = RouteLeg & { wait?: true };

/** Étapes du trajet : une attente à l'arrêt est ajoutée avant chaque course que ne précède pas une marche. */
export function stepsOf(route: TripRoute): Step[] {
  const out: Step[] = [];
  for (const leg of route.legs) {
    const prev = out.at(-1);
    if (leg.mode !== 'walk' && prev?.mode !== 'walk') {
      out.push({
        mode: 'walk',
        from: leg.from,
        to: leg.from,
        departs: prev?.arrives ?? leg.departs,
        arrives: leg.departs,
        scheduledDeparts: prev?.scheduledArrives ?? leg.scheduledDeparts,
        scheduledArrives: leg.scheduledDeparts,
        path: [],
        wait: true,
      });
    }
    out.push(leg);
  }
  return out;
}

/** Position reçue du GPS : précision en mètres, heure en millisecondes. */
export type Fix = LatLon & { accuracy: number; at: number };

/** Où l'on en est : étape en cours (`steps.length` : arrivé), et ce qu'il faut retenir des positions précédentes. */
export type Progress = {
  step: number;
  /** Passé près de l'arrêt de la course à prendre (depuis le début de l'étape). */
  nearStop: boolean;
  /** Positions consécutives qui disent de passer à l'étape suivante. */
  streak: number;
  /** Dernière position retenue, et vitesse (m/s) entre les deux dernières. */
  last: Fix | null;
  speed: number | null;
  /** Position écartée comme un saut, retenue si la suivante la confirme. */
  pending: Fix | null;
};

export const START: Progress = { step: 0, nearStop: false, streak: 0, last: null, speed: null, pending: null };

/** Position trop imprécise pour décider : ignorée. */
export const MAX_ACCURACY_M = 80;
/** Vitesse impossible en ville (160 km/h) : un saut du GPS, sauf si la position suivante le confirme. */
export const JUMP_SPEED = 45;
/** À l'arrêt : à moins de 60 m. */
export const NEAR_STOP_M = 60;
/** Sur le tracé de la course : à moins de 40 m. */
export const ON_PATH_M = 40;
/** Dans le véhicule : plus de 16 km/h. */
export const RIDE_SPEED = 4.5;
/** Descendu : à moins de 100 m de l'arrêt de descente, au pas (moins de 8 km/h). */
export const ALIGHT_M = 100;
export const WALK_SPEED = 2.2;
/** Arrivé : à moins de 50 m de la destination. */
export const ARRIVE_M = 50;
/** Positions consécutives qu'il faut pour passer à l'étape suivante. */
export const STREAK = 2;

const nextStep = (p: Progress, steps: Step[]): Progress => ({ ...p, step: Math.min(p.step + 1, steps.length), nearStop: false, streak: 0 });

/** Retient la position (ou l'écarte : imprécise, saut du GPS) ; `accepted` faux : rien à décider. */
function accept(p: Progress, fix: Fix): { p: Progress; accepted: boolean } {
  if (fix.accuracy > MAX_ACCURACY_M) return { p, accepted: false };
  if (!p.last) return { p: { ...p, last: fix, speed: null, pending: null }, accepted: true };
  const seconds = (fix.at - p.last.at) / 1000;
  if (seconds <= 0) return { p, accepted: false };
  const speed = distanceMeters(p.last, fix) / seconds;
  if (speed <= JUMP_SPEED) return { p: { ...p, last: fix, speed, pending: null }, accepted: true };
  // Saut : retenu seulement si la position suivante est cohérente avec lui (on a vraiment bougé, ou le GPS s'est recalé).
  if (p.pending) {
    const s = (fix.at - p.pending.at) / 1000;
    if (s > 0 && distanceMeters(p.pending, fix) / s <= JUMP_SPEED) return { p: { ...p, last: fix, speed: distanceMeters(p.pending, fix) / s, pending: null }, accepted: true };
  }
  return { p: { ...p, pending: fix }, accepted: false };
}

/** Avance d'après une nouvelle position : montée (vite, près de l'arrêt ou sur le tracé), descente (au pas, près de l'arrêt), arrivée. */
export function advance(progress: Progress, steps: Step[], fix: Fix): Progress {
  const { p, accepted } = accept(progress, fix);
  const step = steps[p.step];
  if (!accepted || !step) return p;
  const speed = p.speed ?? 0;
  const next = steps[p.step + 1];
  const decide = (yes: boolean, nearStop = p.nearStop): Progress => {
    const streak = yes ? p.streak + 1 : 0;
    return streak >= STREAK ? nextStep(p, steps) : { ...p, nearStop, streak };
  };
  if (step.mode === 'walk') {
    if (!next) return distanceMeters(fix, step.to) <= ARRIVE_M ? nextStep(p, steps) : { ...p, streak: 0 };
    const nearStop = p.nearStop || distanceMeters(fix, next.from) <= NEAR_STOP_M;
    return decide(speed >= RIDE_SPEED && (nearStop || distanceToPath(next.path, fix) <= ON_PATH_M), nearStop);
  }
  return decide(speed <= WALK_SPEED && distanceMeters(fix, step.to) <= ALIGHT_M);
}

/** Le bouton du panneau : étape suivante. */
export const manualNext = (p: Progress, steps: Step[]): Progress => nextStep(p, steps);

/** Déjà monté dans un bus ou un tram : on suit alors les courses, au lieu de recalculer l'itinéraire. */
export const boarded = (steps: Step[], step: number) => steps.slice(0, step + 1).some((s) => s.mode !== 'walk');

/** Courses à rafraîchir : celles de l'étape en cours et des suivantes. */
export function rideRefs(steps: Step[], step: number): RideRef[] {
  return steps.slice(step).flatMap((s) => (s.mode !== 'walk' && s.tripId ? [{ tripId: s.tripId, from: s.from, to: s.to }] : []));
}

/**
 * Nouvelles heures des courses suivies, fusionnées dans le trajet : heures, retard et course entière de chaque course
 * retrouvée ; les marches qui suivent une course glissent d'autant.
 */
export function mergeRides(route: TripRoute, updates: (RideUpdate | null)[]): TripRoute {
  const byTrip = new Map(updates.flatMap((u) => (u ? [[u.tripId, u] as const] : [])));
  let shift = 0;
  const legs = route.legs.map((leg): RouteLeg => {
    if (leg.mode === 'walk') {
      if (shift === 0) return leg;
      const move = (iso: string) => new Date(Date.parse(iso) + shift).toISOString();
      return { ...leg, departs: move(leg.departs), arrives: move(leg.arrives) };
    }
    const u = leg.tripId ? byTrip.get(leg.tripId) : undefined;
    if (!u) {
      shift = 0;
      return leg;
    }
    shift = Date.parse(u.arrives) - Date.parse(leg.arrives);
    const { delayMinutes: _d, cancelled: _c, ...rest } = leg;
    return {
      ...rest,
      departs: u.departs,
      arrives: u.arrives,
      scheduledDeparts: u.scheduledDeparts,
      scheduledArrives: u.scheduledArrives,
      ...(u.delayMinutes !== undefined && { delayMinutes: u.delayMinutes }),
      ...(u.cancelled && { cancelled: true }),
      course: u.course,
    };
  });
  return { ...route, legs };
}

const VEHICLE: Record<Exclude<TripLegMode, 'walk'>, string> = { bus: 'bus', tram: 'tram', rail: 'train' };
/** « tram », « bus », « train ». */
export const vehicleWord = (mode: TripLegMode) => (mode === 'walk' ? 'à pied' : VEHICLE[mode]);
/** « tram A ». */
export const vehicleName = (leg: RouteLeg) => `${vehicleWord(leg.mode)} ${leg.line ?? ''}`.trim();
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hour = (iso: string) => hourText(new Date(iso));
/** Minutes entières d'ici `iso` (arrondies au plus proche). */
export const minutesUntil = (iso: string, now: Date) => Math.round((Date.parse(iso) - now.getTime()) / 60_000);

/** Distance à pied lisible : « 180 m », « 1,2 km ». */
export function walkDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}
/** Minutes de marche pour une distance à vol d'oiseau (détours compris, 4,5 km/h). */
export const walkMinutes = (meters: number) => Math.max(1, Math.round((meters * 1.3) / 75));

/** Retard en clair : « +2 min », « −1 min » ; rien sans retard. */
export const delayText = (minutes: number | undefined) => (!minutes ? undefined : minutes > 0 ? `+${minutes} min` : `−${-minutes} min`);

export type Headline = { icon: TripLegMode | 'flag'; title: string; detail: string };

/** Nom du lieu où mène une marche : l'arrêt de la course suivante, ou le lieu du rendez-vous. */
const walkTarget = (steps: Step[], i: number, route: TripRoute) => steps[i + 1]?.from.name ?? route.destination.place;

/** L'étape en cours en gros : quoi faire, puis distance, durée et ce qu'on attend. */
export function headline(route: TripRoute, steps: Step[], progress: Progress, fix: LatLon | null, now: Date): Headline {
  const i = progress.step;
  const step = steps[i];
  if (!step) return { icon: 'flag', title: `Arrivée : ${route.destination.place}`, detail: `${route.destination.title} à ${hour(route.destination.start)}` };
  if (step.mode !== 'walk') {
    const n = minutesUntil(step.arrives, now);
    const stops = step.course ? step.course.alight - step.course.board : 0;
    const detail = [
      step.headsign && `direction ${step.headsign}`,
      stops > 0 && `${stops} arrêt${stops > 1 ? 's' : ''}`,
      n <= 0 ? 'descente maintenant' : `descente dans ${durationText(n)}`,
      delayText(step.delayMinutes) && `${delayText(step.delayMinutes)} de retard`,
    ];
    return { icon: step.mode, title: `${capital(vehicleName(step))} jusqu’à ${step.to.name}`, detail: detail.filter(Boolean).join(' · ') };
  }
  const meters = fix ? distanceMeters(fix, step.to) : null;
  const next = steps[i + 1];
  if (!next) {
    const detail = [meters !== null ? walkDistance(meters) : null, durationText(meters !== null ? walkMinutes(meters) : minutesBetween(step)), `arrivée prévue à ${hour(step.arrives)}`];
    return { icon: 'walk', title: `Marche jusqu’à ${route.destination.place}`, detail: detail.filter(Boolean).join(' · ') };
  }
  const wait = minutesUntil(next.departs, now);
  const coming = wait <= 0 ? `le ${vehicleWord(next.mode)} part maintenant` : `le ${vehicleWord(next.mode)} arrive dans ${durationText(wait)}`;
  const atStop = step.wait || progress.nearStop || (meters !== null && meters <= NEAR_STOP_M);
  if (atStop) {
    const title = i > 0 ? `Correspondance : ${vehicleName(next)} à ${next.from.name}` : `Attends le ${vehicleName(next)} à l’arrêt ${next.from.name}`;
    return { icon: next.mode, title, detail: [next.headsign && `direction ${next.headsign}`, coming].filter(Boolean).join(' · ') };
  }
  const detail = [meters !== null ? walkDistance(meters) : null, durationText(meters !== null ? walkMinutes(meters) : minutesBetween(step)), coming];
  return { icon: 'walk', title: `Marche jusqu’à l’arrêt ${walkTarget(steps, i, route)}`, detail: detail.filter(Boolean).join(' · ') };
}

const minutesBetween = (leg: RouteLeg) => Math.max(1, Math.round((Date.parse(leg.arrives) - Date.parse(leg.departs)) / 60_000));

/** Texte du bouton qui passe à l'étape suivante ; null une fois arrivé. */
export function nextLabel(steps: Step[], progress: Progress): string | null {
  const step = steps[progress.step];
  if (!step) return null;
  if (step.mode !== 'walk') return `J’ai quitté le ${vehicleWord(step.mode)}`;
  const next = steps[progress.step + 1];
  return next ? `Je suis dans le ${vehicleWord(next.mode)}` : 'Je suis sur place';
}

export type StepRow = { mode: TripLegMode | 'flag'; time: string; text: string; delay?: string; state: 'done' | 'current' | 'next' };

/** Liste des étapes horodatées, la dernière ligne étant l'arrivée. */
export function stepRows(route: TripRoute, steps: Step[], progress: Progress): StepRow[] {
  const state = (i: number): StepRow['state'] => (i < progress.step ? 'done' : i === progress.step ? 'current' : 'next');
  const rows = steps.map((s, i): StepRow => {
    if (s.mode !== 'walk') return { mode: s.mode, time: hour(s.departs), text: `${capital(vehicleName(s))} → ${s.to.name}`, ...(delayText(s.delayMinutes) && { delay: delayText(s.delayMinutes) }), state: state(i) };
    if (s.wait) return { mode: 'walk', time: hour(s.departs), text: i > 0 ? `Correspondance à ${s.to.name}` : `Attente à ${s.to.name}`, state: state(i) };
    return { mode: 'walk', time: hour(s.departs), text: `À pied jusqu’à ${walkTarget(steps, i, route)} · ${durationText(minutesBetween(s))}`, state: state(i) };
  });
  const last = steps.at(-1);
  rows.push({ mode: 'flag', time: last ? hour(last.arrives) : '', text: `Arrivée · ${route.destination.place}`, state: progress.step >= steps.length ? 'current' : 'next' });
  return rows;
}
