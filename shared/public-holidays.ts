// Jours fériés de France métropolitaine, calculés sur place (aucun réseau) : dates fixes, plus le lundi de Pâques,
// l'Ascension et le lundi de Pentecôte tirés de la date de Pâques. Le lundi de Pentecôte compte comme férié (pas
// d'école). Pas les jours propres à l'Alsace-Moselle ni à l'outre-mer. Jours locaux AAAA-MM-JJ.

/** Un jour férié : `day` AAAA-MM-JJ, `name` tel qu'on le dit (« 11 novembre », « lundi de Pâques »). */
export type PublicHoliday = { day: string; name: string };

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (year: number, month: number, date: number) => `${year}-${pad(month)}-${pad(date)}`;

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const date = ((h + l - 7 * m + 114) % 31) + 1;
  return dayOf(year, month, date);
}

/** `day` décalé de `days` jours (calcul en UTC, sans fuseau horaire). */
function shift(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const cache = new Map<number, PublicHoliday[]>();

/** Les 11 jours fériés de l'année, dans l'ordre. */
export function publicHolidaysOf(year: number): PublicHoliday[] {
  const known = cache.get(year);
  if (known) return known;
  const easter = easterSunday(year);
  const list = [
    { day: dayOf(year, 1, 1), name: '1er janvier' },
    { day: shift(easter, 1), name: 'lundi de Pâques' },
    { day: dayOf(year, 5, 1), name: '1er mai' },
    { day: dayOf(year, 5, 8), name: '8 mai' },
    { day: shift(easter, 39), name: 'Ascension' },
    { day: shift(easter, 50), name: 'lundi de Pentecôte' },
    { day: dayOf(year, 7, 14), name: '14 juillet' },
    { day: dayOf(year, 8, 15), name: '15 août' },
    { day: dayOf(year, 11, 1), name: 'Toussaint' },
    { day: dayOf(year, 11, 11), name: '11 novembre' },
    { day: dayOf(year, 12, 25), name: 'Noël' },
  ].sort((x, y) => x.day.localeCompare(y.day));
  cache.set(year, list);
  return list;
}

/** Le jour férié `day`, sinon undefined. */
export const publicHolidayOn = (day: string): PublicHoliday | undefined =>
  publicHolidaysOf(Number(day.slice(0, 4))).find((h) => h.day === day);

/** Vrai si `day` est férié. */
export const isPublicHoliday = (day: string) => publicHolidayOn(day) !== undefined;
