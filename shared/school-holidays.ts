// Vacances scolaires, communes au serveur et au front : périodes (calendrier officiel, voir
// server/sources/school-holidays.ts), ce qu'il faut en dire aujourd'hui (« Vacances de Noël dans 12 jours »…) et
// les jours de vacances (trajet du matin, emploi du temps et routines d'école mis de côté). Jours locaux AAAA-MM-JJ.

/** Une période de vacances (ou un pont) : `start` premier jour sans école, `end` jour de la reprise (null : inconnu). */
export type SchoolHoliday = { name: string; start: string; end: string | null };

/** Ce que la famille voit aujourd'hui ; null : rien à dire (vacances lointaines, jour de reprise, pas de données). */
export type HolidayStatus =
  | { kind: 'soon'; name: string; start: string; days: number }
  | { kind: 'last-day'; name: string; start: string }
  | { kind: 'during'; name: string; end: string | null };

/** Les prochaines vacances sont annoncées à partir de 3 semaines avant. */
export const HOLIDAY_SOON_DAYS = 21;
/** Fin supposée de vacances dont la reprise n'est pas encore publiée (« Début des vacances d'été »). */
const UNKNOWN_END_DAYS = 70;

const DAY_MS = 86_400_000;
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Jour AAAA-MM-JJ en date UTC (calculs sans fuseau horaire). */
const utc = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** `day` décalé de `days` jours. */
export const shiftDay = (day: string, days: number) => isoDay(new Date(utc(day).getTime() + days * DAY_MS));

/** Jours de `from` à `to` (positif si `to` est après). */
export const daysBetween = (from: string, to: string) => Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS);

/** 0 dimanche … 6 samedi. */
export const weekdayOf = (day: string) => utc(day).getUTCDay();

/** Lendemain des vacances (exclu) : la reprise, ou une fin supposée si elle n'est pas connue. */
const endOf = (h: SchoolHoliday) => h.end ?? shiftDay(h.start, UNKNOWN_END_DAYS);

/** Vacances en cours le jour `day`, sinon undefined. */
export const holidayOn = (holidays: readonly SchoolHoliday[], day: string) =>
  holidays.find((h) => h.start <= day && day < endOf(h));

/** Vrai si `day` est un jour de vacances (week-ends compris). */
export const isHolidayDay = (holidays: readonly SchoolHoliday[], day: string) => holidayOn(holidays, day) !== undefined;

/** Dernier jour de classe avant `start` : le jour de semaine (lundi à vendredi) qui précède. */
export function lastSchoolDayBefore(start: string): string {
  let day = shiftDay(start, -1);
  while (weekdayOf(day) === 0 || weekdayOf(day) === 6) day = shiftDay(day, -1);
  return day;
}

/** Ce qu'il faut dire des vacances le jour `today`. */
export function holidayStatus(holidays: readonly SchoolHoliday[] | null, today: string): HolidayStatus | null {
  if (!holidays) return null;
  const current = holidayOn(holidays, today);
  if (current) return { kind: 'during', name: current.name, end: current.end };
  const next = holidays.filter((h) => h.start > today).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (!next) return null;
  if (today === lastSchoolDayBefore(next.start)) return { kind: 'last-day', name: next.name, start: next.start };
  const days = daysBetween(today, next.start);
  return days <= HOLIDAY_SOON_DAYS ? { kind: 'soon', name: next.name, start: next.start, days } : null;
}

/** « lundi 4 janvier », « mardi 1er septembre ». */
export function formatHolidayDay(day: string): string {
  const date = utc(day);
  const d = date.getUTCDate();
  return `${WEEKDAYS[date.getUTCDay()]} ${d === 1 ? '1er' : d} ${MONTHS[date.getUTCMonth()]}`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** « les vacances de Noël », « le pont de l’Ascension ». */
function withArticle(name: string): string {
  if (/^vacances\b/i.test(name)) return `les ${lowerFirst(name)}`;
  if (/^pont\b/i.test(name)) return `le ${lowerFirst(name)}`;
  return 'les vacances';
}

/** Texte affiché : « Vacances de Noël dans 12 jours », « Dernier jour avant les vacances de Noël », « Vacances de Noël · reprise lundi 4 janvier ». */
export function holidayText(status: HolidayStatus): string {
  switch (status.kind) {
    case 'soon':
      return status.days === 1 ? `${status.name} demain` : `${status.name} dans ${status.days} jours`;
    case 'last-day':
      return `Dernier jour avant ${withArticle(status.name)}`;
    case 'during':
      return status.end ? `${status.name} · reprise ${formatHolidayDay(status.end)}` : status.name;
  }
}
