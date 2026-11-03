import { describe, expect, it } from 'vitest';
import type { CalendarEvent, WeekData } from '../../../shared/types.ts';
import { agendaDays } from './agenda.ts';

const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
const ev = (id: string, day: number, hour: number): CalendarEvent => ({ id, title: id, start: at(day, hour), end: at(day, hour + 1) });

const week = (start: number, owners: WeekData['owners']): WeekData => ({ start: new Date(2026, 10, start).toISOString(), offset: 0, owners });

describe('agenda du téléphone', () => {
  it('7 jours à partir d’aujourd’hui, son profil et la famille, jours vides omis', () => {
    const weeks = [
      week(2, [
        { ownerId: 'alex', events: [ev('passé', 2, 9), ev('foot', 4, 18)], courses: [] },
        { ownerId: 'sam', events: [ev('piscine', 4, 17)], courses: null },
        { ownerId: 'famille', events: [ev('diner', 4, 20)], courses: null },
      ]),
      week(9, [
        { ownerId: 'alex', events: [ev('dentiste', 9, 10), ev('trop loin', 11, 10)], courses: [] },
        { ownerId: 'famille', events: [], courses: null },
      ]),
    ];
    const days = agendaDays(weeks, new Set(['alex', 'famille']), new Date(2026, 10, 3, 12));
    expect(days.map((d) => [d.date.getDate(), d.items.map((i) => `${i.when} ${i.title}`)])).toEqual([
      [4, ['18:00 foot', '20:00 diner']],
      [9, ['10:00 dentiste']],
    ]);
  });
});
