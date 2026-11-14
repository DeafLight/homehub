// Rappels sur la télé (fonction 5 de l'appli HomeHub TV, docs/appli-tele.md) : à l'heure réglée, le serveur pousse un
// bandeau aux télés allumées (« Routine du soir : Léa, encore 2 étapes »). Chaque rappel a son réglage (actif ou non,
// heure) pour ne pas lasser. Rien de plus que ce que la tablette montre déjà : des prénoms et des nombres, jamais le
// texte d'un mot. Le mécanisme est générique (genre de rappel, heure, texte construit au moment de l'envoi) : l'heure du
// coucher (fonction 16) s'y ajoutera comme un genre de plus. Règles pures, communes au serveur et au front.
import { localDay } from './dates.ts';

/** Genres de rappel, dans l'ordre de la page de réglage. */
export const SCREEN_REMINDER_KINDS = ['evening-routine', 'notes'] as const;
export type ScreenReminderKind = (typeof SCREEN_REMINDER_KINDS)[number];

/** Réglage d'un rappel : actif ou non, heure locale HH:MM. */
export type ScreenReminderSetting = { kind: ScreenReminderKind; enabled: boolean; time: string };
export type ScreenReminderSettings = { reminders: ScreenReminderSetting[] };

/** Réglages tant que rien n'est enregistré : les deux rappels actifs, le soir. */
export const SCREEN_REMINDER_DEFAULTS: Record<ScreenReminderKind, { enabled: boolean; time: string }> = {
  'evening-routine': { enabled: true, time: '19:30' },
  notes: { enabled: true, time: '18:30' },
};

/** Nom et explication de chaque rappel, pour la page de réglage. */
export const SCREEN_REMINDER_LABELS: Record<ScreenReminderKind, { name: string; hint: string }> = {
  'evening-routine': { name: 'Routine du soir', hint: 'Qui a encore des étapes à cocher, et combien' },
  notes: { name: 'Mots à lire', hint: 'Qui a des mots pas encore vus, et combien (jamais leur texte)' },
};

/**
 * Rattrapage : une télé allumée dans les CATCH_UP minutes qui suivent l'heure reçoit encore le rappel ; au-delà, il
 * attend le lendemain (un serveur qui redémarre à 23 h ne rappelle pas la routine de 19 h 30).
 */
export const SCREEN_REMINDER_CATCH_UP_MIN = 30;
/** Durée du bandeau sur la télé. */
export const SCREEN_REMINDER_SECONDS = 20;

/** Bandeau de rappel ; `reminder` : son genre (chaîne libre pour qu'une appli ancienne ignore un genre nouveau). */
export type ScreenReminderEvent = { kind: 'reminder'; id: string; reminder: string; title: string; subtitle: string; seconds: number };
/** Texte d'un rappel ; null : rien à rappeler (routines faites, mots lus), pas de bandeau. */
export type ScreenReminderText = { title: string; subtitle: string } | null;

const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Le rappel réglé à `time` est à envoyer maintenant : heure passée de moins de CATCH_UP minutes, pas encore envoyé ce jour. */
export function reminderDue(time: string, now: Date, sentDay: string | null): boolean {
  if (sentDay === localDay(now)) return false;
  const late = now.getHours() * 60 + now.getMinutes() - minutesOf(time);
  return late >= 0 && late < SCREEN_REMINDER_CATCH_UP_MIN;
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** « Routine du soir » : membres qui ont encore des étapes, dans l'ordre donné ; null si tout est coché. */
export function routineReminderText(members: { name: string; left: number }[]): ScreenReminderText {
  const left = members.filter((m) => m.left > 0);
  if (!left.length) return null;
  return { title: 'Routine du soir', subtitle: left.map((m) => `${m.name} : encore ${plural(m.left, 'étape')}`).join(' · ') };
}

/** « Mots à lire » : destinataires qui ont des mots pas encore vus ; null s'il n'y en a pas. */
export function notesReminderText(owners: { name: string; count: number }[]): ScreenReminderText {
  const unseen = owners.filter((o) => o.count > 0);
  if (!unseen.length) return null;
  return { title: 'Mots à lire sur la tablette', subtitle: unseen.map((o) => `${o.name} : ${plural(o.count, 'mot')}`).join(' · ') };
}

/** Réglages complets : un par genre, dans l'ordre, ceux qui manquent pris aux valeurs par défaut. */
export function withDefaults(saved: Partial<Record<string, { enabled: boolean; time: string }>>): ScreenReminderSettings {
  return { reminders: SCREEN_REMINDER_KINDS.map((kind) => ({ kind, ...(saved[kind] ?? SCREEN_REMINDER_DEFAULTS[kind]) })) };
}
