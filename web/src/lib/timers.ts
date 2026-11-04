// Minuteurs : activités proposées, roue du temps et affichage du temps restant (logique pure, testée).
import { type Timer, TIMER_MAX_SECONDS } from '../../../shared/types.ts';

/** Raccourcis de durée, en minutes (la roue tourne jusque-là). */
export const TIMER_PRESETS = [1, 3, 5, 15, 20, 30, 45, 60, 90, 120];
/** Durée de la roue à l'ouverture. Un tour de roue : une heure ; on peut en faire plusieurs, jusqu'au maximum. */
export const DIAL_DEFAULT_MINUTES = 10;
export const DIAL_LAP_MINUTES = 60;
export const TIMER_MAX_MINUTES = TIMER_MAX_SECONDS / 60;

/** Activités proposées (facultatives : sans, « Minuteur ») : un emoji et une couleur, reprise partout. */
export const TIMER_ACTIVITIES = [
  { label: 'Cuisson', emoji: '🍝', color: '#f2b84b' },
  { label: 'Écrans', emoji: '📺', color: '#5b8def' },
  { label: 'Devoirs', emoji: '📚', color: '#3fcf7f' },
  { label: 'Dents', emoji: '🦷', color: '#9cc3f5' },
  { label: 'Douche', emoji: '🚿', color: '#3fb8a8' },
  { label: 'Jeux', emoji: '🎲', color: '#d96aa7' },
] as const;
const DEFAULT_LOOK = { emoji: '⏱️', color: '#cfd3d9' };

/** Emoji et couleur d'un minuteur, d'après son nom. */
export function timerLook(label: string): { emoji: string; color: string } {
  const activity = TIMER_ACTIVITIES.find((a) => a.label === label);
  return activity ? { emoji: activity.emoji, color: activity.color } : DEFAULT_LOOK;
}

/** Position sur le cadran (0 à 60, non arrondie) d'un angle en radians (0 en haut, sens horaire). */
export function dialPosition(angle: number): number {
  const turn = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return (turn / (2 * Math.PI)) * DIAL_LAP_MINUTES;
}

const clampMinutes = (minutes: number) => Math.max(0, Math.min(TIMER_MAX_MINUTES, minutes));

/**
 * Le doigt passe de la position `from` à `to` sur le cadran : la durée avance (ou recule) d'autant, en passant le haut
 * sans sauter (un tour de plus ou de moins). Jamais sous 0 ni au-delà du maximum.
 */
export function dialTurn(minutes: number, from: number, to: number): number {
  let delta = to - from;
  if (delta > DIAL_LAP_MINUTES / 2) delta -= DIAL_LAP_MINUTES;
  if (delta < -DIAL_LAP_MINUTES / 2) delta += DIAL_LAP_MINUTES;
  return clampMinutes(minutes + delta);
}

/** Toucher le cadran à la position `at` : la durée la plus proche de l'actuelle qui tombe à cet endroit. */
export function dialTap(minutes: number, at: number): number {
  const lap = Math.floor(minutes / DIAL_LAP_MINUTES);
  const candidates = [lap - 1, lap, lap + 1].map((l) => l * DIAL_LAP_MINUTES + at).filter((m) => m >= 0);
  const nearest = candidates.reduce((best, m) => (Math.abs(m - minutes) < Math.abs(best - minutes) ? m : best));
  return clampMinutes(nearest);
}

/** Part du temps qui reste (1 : tout juste lancé, 0 : terminé). */
export const timerProgress = (timer: Pick<Timer, 'endsAt' | 'durationSeconds'>, now: Date) =>
  timer.durationSeconds > 0 ? Math.min(1, secondsLeft(timer, now) / timer.durationSeconds) : 0;

/** « fin à 19 h 52 », « fin demain à 2 h 10 ». */
export function endsAtText(now: Date, minutes: number): string {
  const end = new Date(now.getTime() + minutes * 60_000);
  const nextDay = end.toDateString() !== now.toDateString();
  return `fin ${nextDay ? 'demain ' : ''}à ${end.getHours()} h ${String(end.getMinutes()).padStart(2, '0')}`;
}

export const timerName = (timer: Pick<Timer, 'label'>) => timer.label || 'Minuteur';

/** Secondes restantes (0 : terminé). */
export const secondsLeft = (timer: Pick<Timer, 'endsAt'>, now: Date) =>
  Math.max(0, Math.ceil((new Date(timer.endsAt).getTime() - now.getTime()) / 1000));

/** « 4:05 », « 1:02:03 ». */
export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** « 5 min », « 1 h », « 1 h 30 ». */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
