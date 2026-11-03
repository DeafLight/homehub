// Mise en forme des dates et des textes affichés (français, fuseau de la tablette).
import type { CalendarEvent, ProfileSummary } from '../../../shared/types.ts';

const LOCALE = 'fr-FR';
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const longDateFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const shortDateFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const formatTime = (date: Date) => timeFormat.format(date);
export const formatLongDate = (date: Date) => longDateFormat.format(date);

/** Nombre de jours calendaires entre deux dates (0 = même jour). */
export function dayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Jour relatif : « Aujourd’hui », « Demain », « Mercredi », ou une date courte. */
export function formatDay(date: Date, now: Date): string {
  const diff = dayDiff(now, date);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  if (diff > 1 && diff < 7) return capitalize(weekdayFormat.format(date));
  return capitalize(shortDateFormat.format(date));
}

/** Depuis quand : « à l’instant », « il y a 5 min », « il y a 2 h », puis « hier à 18:30 », « lundi à 08:00 ». */
export function formatAgo(date: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const diff = dayDiff(date, now);
  if (diff === 0) return `il y a ${Math.floor(minutes / 60)} h`;
  const day = diff === 1 ? 'hier' : diff < 7 ? weekdayFormat.format(date) : shortDateFormat.format(date);
  return `${day} à ${formatTime(date)}`;
}

/** « Demain à 08:30 » */
export const formatWhen = (date: Date, now: Date) => `${formatDay(date, now)} à ${formatTime(date)}`;

/**
 * Quand a lieu un événement :
 * - « Demain à 08:30 », ou « Demain » s'il dure toute la journée ;
 * - sur plusieurs jours : « Vendredi 18:00 → dimanche 14:00 », « Mercredi → vendredi » ;
 * - sur plusieurs jours et déjà commencé : « Jusqu’à dimanche 14:00 ».
 */
export function formatEventWhen(event: CalendarEvent, now: Date): string {
  const start = new Date(event.start);
  const moment = (date: Date) => (event.allDay ? formatDay(date, now) : `${formatDay(date, now)} ${formatTime(date)}`);

  if (event.end) {
    const end = new Date(event.end);
    // Pour un événement sur la journée, la fin est minuit le lendemain du dernier jour.
    const last = event.allDay ? new Date(end.getTime() - 1) : end;
    if (dayDiff(start, new Date(end.getTime() - 1)) > 0) {
      if (start <= now) return `Jusqu’à ${moment(last).toLowerCase()}`;
      return `${moment(start)} → ${moment(last).toLowerCase()}`;
    }
  }
  return event.allDay ? formatDay(start, now) : formatWhen(start, now);
}

export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return 'Bonne nuit';
  if (hour < 18) return 'Bonjour';
  return 'Bonsoir';
}

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count > 1 ? plural : singular}`;

/** Ligne de résumé d'un profil sur l'écran d'accueil. */
export function profileHeadline(summary: ProfileSummary, now: Date): string {
  // Cours et rendez-vous au même niveau : le premier qui arrive l'emporte.
  const { nextEvent, nextCourse } = summary;
  if (nextCourse && (!nextEvent || new Date(nextCourse.start) < new Date(nextEvent.start))) {
    return eventLine({ id: nextCourse.id, title: nextCourse.subject, start: nextCourse.start }, now);
  }
  if (nextEvent) return eventLine(nextEvent, now);
  if (summary.pendingTasks > 0) return `${pluralize(summary.pendingTasks, 'tâche')} à faire`;
  return 'Rien de prévu';
}

/** « Piscine · demain à 17:30 » */
export function eventLine(event: CalendarEvent, now: Date): string {
  return `${event.title} · ${formatEventWhen(event, now).toLowerCase()}`;
}
