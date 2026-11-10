// Listes de la famille : libellés des échéances et des répétitions, choix proposés à l'ajout.
import { localDay } from '../../../shared/dates.ts';
import type { ListTask, Repeat } from '../../../shared/types.ts';
import { addDays } from './day.ts';
import { capitalize, dayDiff, formatTime } from './format.ts';

const weekdayShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const weekdayLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** Minuit local du jour AAAA-MM-JJ. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const isLate = (task: ListTask, now: Date) => !task.done && task.due !== null && task.due < localDay(now);

/** « chaque semaine », « tous les 3 jours »… */
export function repeatLabel({ every, unit }: Repeat): string {
  if (every === 1) return unit === 'day' ? 'chaque jour' : 'chaque semaine';
  return unit === 'day' ? `tous les ${every} jours` : `toutes les ${every} semaines`;
}

/** Échéance relative : « Aujourd’hui », « Demain », « Vendredi », « 12 nov. », « En retard · hier ». */
export function dueLabel(due: string, now: Date): string {
  const diff = dayDiff(now, parseDay(due));
  const date = parseDay(due);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  if (diff > 1 && diff < 7) return capitalize(weekdayLong.format(date));
  if (diff === -1) return 'En retard · hier';
  if (diff < 0 && diff > -7) return `En retard · ${weekdayShort.format(date)}`;
  return diff < 0 ? `En retard · ${dayMonth.format(date)}` : dayMonth.format(date);
}

type NameOf = (ownerId: string | null) => string | null;

/** Ligne sous une tâche : échéance et répétition, ou qui l'a faite et quand. */
export function taskMeta(task: ListTask, now: Date, nameOf: NameOf): string {
  if (task.done) {
    const who = task.doneBy && nameOf(task.doneBy.ownerId);
    return `Fait à ${task.doneAt ? formatTime(new Date(task.doneAt)) : '—'}${who ? ` par ${who}` : ''}`;
  }
  const parts = [task.due ? dueLabel(task.due, now) : null, task.repeat ? `${repeatLabel(task.repeat)} ↻` : null];
  return parts.filter(Boolean).join(' · ') || 'Sans date';
}

export type DueChoice = { label: string; value: string | null };

/** Échéances proposées à l'ajout d'une tâche (la saisie d'une date précise s'ajoute à côté). */
export const dueChoices = (now: Date): DueChoice[] => [
  { label: 'Pas de date', value: null },
  { label: 'Aujourd’hui', value: localDay(now) },
  { label: 'Demain', value: localDay(addDays(now, 1)) },
];

export const REPEAT_CHOICES: { label: string; value: Repeat | null }[] = [
  { label: 'Jamais', value: null },
  { label: 'Chaque jour', value: { every: 1, unit: 'day' } },
  { label: 'Chaque semaine', value: { every: 1, unit: 'week' } },
  { label: 'Toutes les 2 semaines', value: { every: 2, unit: 'week' } },
];

/** Texte reçu par « Partager » (titre, texte, lien), sans répétition. */
export function sharedText(params: URLSearchParams): string {
  const parts: string[] = [];
  for (const key of ['title', 'text', 'url']) {
    const value = params.get(key)?.trim();
    if (value && !parts.some((p) => p.includes(value))) parts.push(value);
  }
  return parts.join(' ').slice(0, 120);
}
