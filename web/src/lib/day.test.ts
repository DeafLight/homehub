import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../../shared/types.ts';
import { eventsAfter, eventsOnDay, fitsInDay, timelineHours, timelineItems, timelinePercent, whenOnDay } from './day.ts';

const at = (day: number, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute);
const ev = (id: string, start: Date, end?: Date, allDay = false): CalendarEvent => ({
  id,
  title: id,
  start: start.toISOString(),
  ...(end && { end: end.toISOString() }),
  ...(allDay && { allDay }),
});
const today = at(2, 14, 10);

const foot = ev('foot', at(2, 18, 15), at(2, 19, 30));
const trip = ev('voyage', at(1, 18), at(3, 10));
const birthday = ev('anniversaire', at(3), at(4), true);
const later = ev('plus-tard', at(5, 9));

describe('découpage par jour', () => {
  it('garde les événements qui touchent le jour', () => {
    const events = [foot, trip, birthday, later];
    expect(eventsOnDay(events, today).map((e) => e.id)).toEqual(['foot', 'voyage']);
    expect(eventsOnDay(events, at(3)).map((e) => e.id)).toEqual(['voyage', 'anniversaire']);
    expect(eventsAfter(events, at(3)).map((e) => e.id)).toEqual(['plus-tard']);
  });

  it('ne met sur la frise que les événements avec heure contenus dans le jour', () => {
    expect(fitsInDay(foot, today)).toBe(true);
    expect(fitsInDay(trip, today)).toBe(false);
    expect(fitsInDay(birthday, at(3))).toBe(false);
  });
});

describe('frise', () => {
  const course = { id: '1', subject: 'Maths', start: at(2, 7, 30).toISOString(), end: at(2, 8, 30).toISOString(), cancelled: false };

  it('mélange cours et événements par heure', () => {
    expect(timelineItems([course], [foot]).map((i) => [i.kind, i.title])).toEqual([
      ['course', 'Maths'],
      ['event', 'foot'],
    ]);
  });

  it('couvre 8 h–20 h, élargi aux éléments qui en sortent', () => {
    expect(timelineHours(timelineItems([], [foot]))).toEqual({ startHour: 8, endHour: 20 });
    const late = ev('concert', at(2, 20), at(2, 22, 30));
    expect(timelineHours(timelineItems([course], [late]))).toEqual({ startHour: 7, endHour: 23 });
  });

  it('place un instant en pourcentage', () => {
    expect(timelinePercent(at(2, 14), 8, 20)).toBe(50);
    expect(timelinePercent(at(2, 6), 8, 20)).toBe(0);
  });
});

describe('whenOnDay', () => {
  it('donne l’horaire vu depuis le jour', () => {
    expect(whenOnDay(foot, today)).toBe('18:15');
    expect(whenOnDay(trip, at(3))).toBe('jusqu’à 10:00');
    expect(whenOnDay(trip, at(1))).toBe('dès 18:00');
    expect(whenOnDay(trip, at(2))).toBe('journée');
    expect(whenOnDay(birthday, at(3))).toBe('journée');
  });
});
