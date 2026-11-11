// Tests de la grille de la semaine : jours, plage d'heures, profils de départ, libellés, bandeaux du jour entier.
import { describe, expect, it } from 'vitest';
import type { CalendarEvent, SchoolCourse, WeekData } from '../../../shared/types.ts';
import { allDayShown, initialOwners, weekDays, weekHours, weekOffsetLabel, weekRangeLabel } from './week.ts';

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();
const ev = (id: string, day: number, start: number, end: number): CalendarEvent => ({ id, title: id, start: at(day, start), end: at(day, end) });
const course = (id: string, day: number, start: number, end: number, cancelled = false): SchoolCourse => ({
  id,
  subject: id,
  start: at(day, start),
  end: at(day, end),
  cancelled,
});

const data: WeekData = {
  start: new Date(2026, 10, 2).toISOString(),
  offset: 0,
  owners: [
    {
      ownerId: 'greg',
      events: [ev('foot', 2, 18, 19), ev('dentiste', 3, 17, 18), { id: 'anniv', title: 'Anniversaire', start: at(7, 0), end: at(8, 0), allDay: true }],
      courses: [{ ...course('maths', 2, 8, 9), room: 'B26' }, course('svt', 2, 14, 17), course('annulé', 3, 8, 9, true), course('anglais', 3, 10, 11)],
    },
    { ownerId: 'lucie', events: [ev('piscine', 2, 18, 20)], courses: null },
    // « foot » est aussi dans l'agenda de la famille.
    { ownerId: 'famille', events: [ev('foot', 2, 18, 19), ev('diner', 2, 20, 21)], courses: null },
  ],
};

const all = new Set(['greg', 'lucie', 'famille']);

describe('semaine', () => {
  it('7 jours, du lundi au dimanche, événements placés et sur la journée à part', () => {
    const days = weekDays(data, { owners: all, courses: false });
    expect(days).toHaveLength(7);
    expect(days[0].date.getDay()).toBe(1);
    expect(days[0].blocks.map((b) => b.title).sort()).toEqual(['diner', 'foot', 'piscine']);
    expect(days[5].allDay.map((a) => [a.title, a.ownerId])).toEqual([['Anniversaire', 'greg']]);
    expect(days[5].blocks).toEqual([]);
  });

  it('un événement partagé avec la famille n’apparaît qu’une fois, au nom du membre', () => {
    const foot = weekDays(data, { owners: all, courses: false })[0].blocks.filter((b) => b.title === 'foot');
    expect(foot.map((b) => b.ownerId)).toEqual(['greg']);
    const familyOnly = weekDays(data, { owners: new Set(['famille']), courses: false })[0].blocks;
    expect(familyOnly.find((b) => b.title === 'foot')?.ownerId).toBe('famille');
  });

  it('les éléments qui se chevauchent se partagent la largeur, les autres la gardent', () => {
    const blocks = weekDays(data, { owners: all, courses: false })[0].blocks;
    const byTitle = Object.fromEntries(blocks.map((b) => [b.title, b]));
    expect([byTitle.foot.lanes, byTitle.piscine.lanes]).toEqual([2, 2]);
    expect(byTitle.foot.lane).not.toBe(byTitle.piscine.lane);
    // Le dîner (20 h) commence quand la piscine finit : il est seul.
    expect([byTitle.diner.lane, byTitle.diner.lanes]).toEqual([0, 1]);
  });

  it('chaque cours a son bloc, comme un événement ; un cours annulé reste visible', () => {
    const days = weekDays(data, { owners: new Set(['greg']), courses: true });
    const courses = (day: number) => days[day].blocks.filter((b) => b.kind === 'course');
    expect(courses(0).map((b) => [b.title, b.meta])).toEqual([
      ['maths', '08:00'],
      ['svt', '14:00'],
    ]);
    expect(courses(0)[0].detail).toBe('B26');
    expect(courses(1).map((b) => [b.title, b.cancelled])).toEqual([
      ['annulé', true],
      ['anglais', false],
    ]);
    expect(weekDays(data, { owners: new Set(['greg']), courses: false })[0].blocks.some((b) => b.kind === 'course')).toBe(false);
  });

  it('plage horaire : 8 h–21 h, élargie si besoin', () => {
    expect(weekHours(weekDays(data, { owners: all, courses: false }))).toEqual({ startHour: 8, endHour: 21 });
    const early: WeekData = { ...data, owners: [{ ownerId: 'greg', events: [ev('tôt', 4, 6, 7), ev('tard', 4, 21, 23)], courses: null }] };
    expect(weekHours(weekDays(early, { owners: all, courses: false }))).toEqual({ startHour: 6, endHour: 23 });
  });

  it('profils affichés à l’ouverture', () => {
    const ids = ['greg', 'lucie', 'famille'];
    expect(initialOwners(ids, 'greg', 'famille')).toEqual(new Set(['greg', 'famille']));
    expect(initialOwners(ids, null, 'famille')).toEqual(new Set(ids));
    expect(initialOwners(ids, 'famille', 'famille')).toEqual(new Set(ids));
    expect(initialOwners(ids, 'inconnu', 'famille')).toEqual(new Set(ids));
  });

  it('libellés', () => {
    expect(weekRangeLabel(new Date(2026, 10, 2))).toBe('Semaine du 2 au 8 novembre');
    expect(weekRangeLabel(new Date(2026, 10, 30))).toBe('Semaine du 30 novembre au 6 décembre');
    expect([0, 1, 2].map(weekOffsetLabel)).toEqual(['Cette semaine', 'Semaine prochaine', 'Dans 2 semaines']);
  });

  it('journée entière : deux bandeaux au plus par jour, puis « +N »', () => {
    const item = (id: string) => ({ id, ownerId: 'lea', title: id, meta: '' });
    expect(allDayShown([item('a')])).toEqual({ shown: [item('a')], more: 0 });
    expect(allDayShown([item('a'), item('b')])).toEqual({ shown: [item('a'), item('b')], more: 0 });
    expect(allDayShown([item('a'), item('b'), item('c'), item('d')])).toEqual({ shown: [item('a'), item('b')], more: 2 });
  });
});
