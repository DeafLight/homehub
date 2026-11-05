// Devoirs du cahier de texte (Pronote ou ÉcoleDirecte), regroupés par jour (logique pure, testée). En lecture seule :
// on les coche dans l'appli du service, HomeHub montre seulement ce qui y est coché.
import type { Homework, ProfileSummary } from '../../../shared/types.ts';
import { capitalize, dayDiff, pluralize } from './format.ts';
import { localDay } from './lists.ts';

/** Heure à partir de laquelle les devoirs du jour ne sont plus montrés (la journée de classe est commencée). */
export const TODAY_HIDDEN_FROM_HOUR = 12;

const weekdayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const dateFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** « AAAA-MM-JJ » → minuit, heure locale. */
export const parseDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** « pour demain », « pour jeudi », « pour lundi 23 novembre » (au-delà d'une semaine). */
export function dueText(due: string, now: Date): string {
  const date = parseDay(due);
  const diff = dayDiff(now, date);
  if (diff === 0) return 'pour aujourd’hui';
  if (diff === 1) return 'pour demain';
  if (diff > 1 && diff < 7) return `pour ${weekdayFormat.format(date)}`;
  return `pour ${dateFormat.format(date)}`;
}

export type HomeworkGroup = { due: string; title: string; items: Homework[]; left: number };

/** Devoirs par jour, dans l'ordre ; ceux d'aujourd'hui seulement le matin. */
export function homeworkGroups(list: Homework[], now: Date): HomeworkGroup[] {
  const today = localDay(now);
  const groups = new Map<string, Homework[]>();
  for (const item of list) {
    if (item.due < today || (item.due === today && now.getHours() >= TODAY_HIDDEN_FROM_HOUR)) continue;
    groups.set(item.due, [...(groups.get(item.due) ?? []), item]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([due, items]) => ({ due, title: capitalize(dueText(due, now)), items, left: items.filter((h) => !h.done).length }));
}

/** Rappel de l'accueil : « 3 devoirs pour demain » ; null s'il n'y a rien à faire. */
export function homeworkReminder(homework: ProfileSummary['homework'], now: Date): string | null {
  if (!homework || homework.left === 0) return null;
  return `${pluralize(homework.left, 'devoir')} ${dueText(homework.due, now)}`;
}
