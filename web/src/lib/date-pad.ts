// Pavé de la date d'un lot (scanner, page Stock, téléphone), sans navigateur : quatre chiffres tapés, « jour et
// mois » (l'année se devine : shared/expiry.ts, guessDay) ou « mois et année » pour une DDM imprimée « 03/2027 »
// (rangée au dernier jour du mois). DatePad.svelte ne garde que l'affichage et les boutons.
import { guessDay, longDay, monthEnd, relativeDay } from '../../../shared/expiry.ts';

export type PadMode = 'day' | 'month';

/** Quatre chiffres au plus ; d'autres touches sont ignorées. */
export const typeDigit = (digits: string, digit: string) => (/^\d$/u.test(digit) && digits.length < 4 ? digits + digit : digits);

/** Chiffres d'une date déjà connue, pour la corriger : « 0911 » (jour et mois). */
export const digitsOf = (day: string | null) => (day ? `${day.slice(8, 10)}${day.slice(5, 7)}` : '');

/** Affichage : « 09 / 11 », « 0_ / __ » ; en mois et année : « 03 / 27 ». */
export function padDisplay(digits: string): string {
  const shown = digits.padEnd(4, '_');
  return `${shown.slice(0, 2)} / ${shown.slice(2, 4)}`;
}

/** Date tapée (AAAA-MM-JJ), ou null tant qu'elle est incomplète ou impossible (31/02, mois 13). */
export function padDate(digits: string, mode: PadMode, today: string): string | null {
  if (digits.length !== 4) return null;
  const first = Number(digits.slice(0, 2));
  const second = Number(digits.slice(2, 4));
  if (mode === 'month') return first >= 1 && first <= 12 ? monthEnd(first, 2000 + second) : null;
  if (second < 1 || second > 12 || first < 1) return null;
  return guessDay(first, second, today);
}

/** Sous la date : « lundi 9 novembre 2026 · dans 4 jours », ou ce qui manque. */
export function padHint(digits: string, mode: PadMode, today: string): string {
  const date = padDate(digits, mode, today);
  if (date) return `${longDay(date)} · ${relativeDay(date, today).replace(' j', ' jours')}`;
  if (digits.length === 4) return 'Date impossible';
  return mode === 'month' ? 'Mois puis année (03 / 27)' : 'Jour puis mois';
}

/** Options rares du pavé, repliées sous « Plus » : une partie du lot à une autre date, retirer la date, ne plus demander. */
export type PadExtra = 'split' | 'clear' | 'never';

export function padExtras(lot: { count: number; date: string | null }, splitting: boolean, canNeverAsk: boolean): PadExtra[] {
  const extras: PadExtra[] = [];
  if (lot.count > 1 && !splitting) extras.push('split');
  if (lot.date && !splitting) extras.push('clear');
  if (canNeverAsk) extras.push('never');
  return extras;
}
