// Devoirs du cahier de texte, communs à Pronote et ÉcoleDirecte : consigne en texte simple, tri, fenêtre affichée.
import type { Homework } from '../../shared/types.ts';
import { localDay } from './lists.ts';

/** Au-delà, la consigne est coupée : le détail (et les pièces jointes) reste dans l'appli du service. */
export const HOMEWORK_TEXT_MAX = 600;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', hellip: '…', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê' };

/** HTML d'une consigne → texte : un saut de ligne par paragraphe ou ligne de liste, balises et espaces en trop retirés. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/giu, '')
    .replace(/<\s*br\s*\/?\s*>/giu, '\n')
    .replace(/<\s*li[^>]*>/giu, '\n• ')
    .replace(/<\s*\/\s*(p|div|li|ul|ol|h\d|tr)\s*>/giu, '\n')
    .replace(/<[^>]*>/gu, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, code: string) => {
      if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/[ \t ]+/gu, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return text.length > HOMEWORK_TEXT_MAX ? `${text.slice(0, HOMEWORK_TEXT_MAX - 1).trimEnd()}…` : text;
}

/** Par jour, puis par matière (ordre stable pour l'affichage). */
export const sortHomework = (list: Homework[]): Homework[] =>
  [...list].sort((a, b) => a.due.localeCompare(b.due) || a.subject.localeCompare(b.subject, 'fr'));

/** Devoirs à faire aujourd'hui ou plus tard (ceux des jours passés ne servent plus). */
export const homeworkFrom = (list: Homework[], now: Date): Homework[] => {
  const today = localDay(now);
  return list.filter((h) => h.due >= today);
};
