// Minuteurs : activités proposées, roue du temps et affichage du temps restant (logique pure, testée).
import type { Timer } from '../../../shared/types.ts';

/** Raccourcis de durée, en minutes (la roue tourne jusque-là). */
export const TIMER_PRESETS = [1, 3, 5, 15, 20, 30, 45, 60];
/** Durée de la roue à l'ouverture, et sa limite (un tour). */
export const DIAL_DEFAULT_MINUTES = 10;
export const DIAL_MAX_MINUTES = 60;

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

/**
 * Minutes indiquées par la roue pour un angle (radians, 0 en haut, sens horaire). Passer le haut ne fait pas sauter de
 * 60 à 0 (ni de 0 à 60) : depuis une valeur proche, on reste en butée.
 */
export function dialMinutes(angle: number, previous: number): number {
  const turn = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const minutes = Math.round((turn / (2 * Math.PI)) * DIAL_MAX_MINUTES) % DIAL_MAX_MINUTES;
  const quarter = DIAL_MAX_MINUTES / 4;
  if (previous >= DIAL_MAX_MINUTES - quarter && minutes <= quarter) return DIAL_MAX_MINUTES;
  if (previous <= quarter && minutes >= DIAL_MAX_MINUTES - quarter) return 0;
  return minutes;
}

/** Part du temps qui reste (1 : tout juste lancé, 0 : terminé). */
export const timerProgress = (timer: Pick<Timer, 'endsAt' | 'durationSeconds'>, now: Date) =>
  timer.durationSeconds > 0 ? Math.min(1, secondsLeft(timer, now) / timer.durationSeconds) : 0;

/** « fin à 19 h 52 ». */
export function endsAtText(now: Date, minutes: number): string {
  const end = new Date(now.getTime() + minutes * 60_000);
  return `fin à ${end.getHours()} h ${String(end.getMinutes()).padStart(2, '0')}`;
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
