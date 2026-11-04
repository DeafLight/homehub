// Minuteurs : durées proposées et affichage du temps restant (logique pure, testée).
import type { Timer } from '../../../shared/types.ts';

/** Durées proposées, en minutes. */
export const TIMER_PRESETS = [1, 3, 5, 10, 15, 20, 30, 45, 60];
/** Noms proposés ; aucun choisi : « Minuteur ». */
export const TIMER_LABELS = ['Cuisson', 'Écrans', 'Devoirs', 'Dents', 'Douche', 'Jeux'];

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
