// Agenda du téléphone : les 7 prochains jours de son profil et de la famille, en liste (sans les cours).
import type { WeekData } from '../../../shared/types.ts';
import { addDays, startOfDay } from './day.ts';
import { weekDays } from './week.ts';

export type AgendaItem = { id: string; ownerId: string; when: string; title: string };
export type AgendaDay = { date: Date; items: AgendaItem[] };

const AGENDA_DAYS = 7;

/** Jours à venir qui ont quelque chose, à partir d'aujourd'hui ; `weeks` : semaine en cours et suivante. */
export function agendaDays(weeks: WeekData[], owners: ReadonlySet<string>, now: Date): AgendaDay[] {
  const from = startOfDay(now);
  const to = addDays(from, AGENDA_DAYS);
  return weeks
    .flatMap((week) => weekDays(week, { owners, courses: false }))
    .filter((day) => day.date >= from && day.date < to)
    .map((day) => ({
      date: day.date,
      items: [
        ...day.allDay.map((e) => ({ id: e.id, ownerId: e.ownerId, when: e.meta, title: e.title })),
        ...day.blocks.map((b) => ({ id: b.id, ownerId: b.ownerId, when: b.meta, title: b.title })),
      ],
    }))
    .filter((day) => day.items.length > 0);
}
