// Découpage d'un agenda par jour et géométrie de la frise horaire (cours + événements).
import type { CalendarEvent, SchoolCourse } from '../../../shared/types.ts';
import { formatTime } from './format.ts';

const DEFAULT_EVENT_MINUTES = 60;
/** Plage affichée par défaut sur la frise ; élargie si un élément en déborde. */
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;

export function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const endOf = (event: CalendarEvent) =>
  event.end ? new Date(event.end) : new Date(new Date(event.start).getTime() + DEFAULT_EVENT_MINUTES * 60_000);

/** Événements qui ont lieu (au moins en partie) ce jour-là. */
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const from = startOfDay(day);
  const to = addDays(from, 1);
  return events.filter((e) => new Date(e.start) < to && endOf(e) > from);
}

/** Vrai pour un événement avec heure, qui commence et finit ce jour-là : il a sa place sur la frise. */
export function fitsInDay(event: CalendarEvent, day: Date): boolean {
  const from = startOfDay(day);
  const to = addDays(from, 1);
  return !event.allDay && new Date(event.start) >= from && endOf(event) <= to;
}

/** Événements qui commencent après la fin de `day` (pour « Cette semaine », après demain). */
export const eventsAfter = (events: CalendarEvent[], day: Date) =>
  events.filter((e) => new Date(e.start) >= addDays(startOfDay(day), 1));

export type TimelineItem = {
  id: string;
  kind: 'course' | 'event';
  title: string;
  start: Date;
  end: Date;
  room?: string;
  location?: string;
  cancelled: boolean;
};

export function timelineItems(courses: SchoolCourse[], events: CalendarEvent[]): TimelineItem[] {
  return [
    ...courses.map((c) => ({
      id: `c-${c.id}`,
      kind: 'course' as const,
      title: c.subject,
      start: new Date(c.start),
      end: new Date(c.end),
      room: c.room,
      cancelled: c.cancelled,
    })),
    ...events.map((e) => ({
      id: `e-${e.id}`,
      kind: 'event' as const,
      title: e.title,
      start: new Date(e.start),
      end: endOf(e),
      location: e.location,
      cancelled: false,
    })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());
}

const minutesOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes();

/** Heures de début et de fin de la frise : 8 h–20 h, élargies aux éléments qui en sortent. */
export function timelineHours(items: TimelineItem[]): { startHour: number; endHour: number } {
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const item of items) {
    startHour = Math.min(startHour, Math.floor(minutesOfDay(item.start) / 60));
    const endMinutes = item.end.getDate() !== item.start.getDate() ? 24 * 60 : minutesOfDay(item.end);
    endHour = Math.max(endHour, Math.ceil(endMinutes / 60));
  }
  return { startHour, endHour };
}

/** Position verticale (en % de la frise) d'un instant du jour. */
export function timelinePercent(date: Date, startHour: number, endHour: number): number {
  const ratio = (minutesOfDay(date) - startHour * 60) / ((endHour - startHour) * 60);
  return Math.min(100, Math.max(0, ratio * 100));
}

/** Horaire d'un événement vu depuis un jour donné : « 18:15 », « dès 18:00 », « jusqu’à 10:00 », « journée ». */
export function whenOnDay(event: CalendarEvent, day: Date): string {
  const from = startOfDay(day);
  const to = addDays(from, 1);
  const start = new Date(event.start);
  const end = endOf(event);
  if (fitsInDay(event, day)) return formatTime(start);
  if (event.allDay) return 'journée';
  if (start >= from) return `dès ${formatTime(start)}`;
  if (end <= to) return `jusqu’à ${formatTime(end)}`;
  return 'journée';
}
