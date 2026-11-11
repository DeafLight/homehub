// Vie scolaire des enfants sur le dashboard d'un parent (logique pure, testée) : résumé du bloc (dernière note,
// absences et retards, messages non lus) et textes du détail. Le serveur ne l'envoie qu'à un parent ; ici on décide
// seulement où la demander (dashboard d'un parent, téléphone d'un parent).
import type { PublicConfig, SchoolAttendance, SchoolGrade, SchoolLife } from '../../../shared/types.ts';
import { capitalize, dayDiff, pluralize } from './format.ts';
import { parseDay } from './homework.ts';

type Member = PublicConfig['members'][number];

/** Rafraîchissement du bloc : les sources gardent déjà leurs données en cache. */
export const SCHOOL_LIFE_REFRESH_MS = 10 * 60_000;

/**
 * Bloc du dashboard : seulement sur le dashboard d'un parent. Il ne s'affiche que si le serveur répond, c'est-à-dire
 * quand un parent est reconnu devant la tablette ; il le redemande à chaque changement de personne reconnue.
 */
export const showsSchoolLife = (members: Pick<Member, 'id' | 'parent'>[], ownerId: string) => members.some((m) => m.id === ownerId && m.parent);

export type ChildSummary = {
  ownerId: string;
  /** Note la plus récente ; null sans note (ou rubrique indisponible). */
  lastGrade: SchoolGrade | null;
  absences: number;
  delays: number;
  /** Absences et retards pas encore justifiés. */
  toJustify: number;
  /** Rien n'a pu être lu pour cet enfant (notes et vie scolaire indisponibles). */
  unavailable: boolean;
};

export function childSummaries(life: SchoolLife): ChildSummary[] {
  return life.children.map((c) => {
    const attendance = c.attendance ?? [];
    return {
      ownerId: c.ownerId,
      lastGrade: c.grades?.[0] ?? null,
      absences: attendance.filter((a) => a.kind === 'absence').length,
      delays: attendance.filter((a) => a.kind === 'delay').length,
      toJustify: attendance.filter((a) => !a.justified).length,
      unavailable: c.grades === null && c.attendance === null,
    };
  });
}

export const unreadCount = (life: SchoolLife) => life.messages.reduce((n, inbox) => n + inbox.items.filter((m) => !m.read).length, 0);

/** Vrai s'il y a quelque chose à montrer (un enfant suivi, ou une messagerie). */
export const hasSchoolLife = (life: SchoolLife | null | undefined): life is SchoolLife =>
  Boolean(life && (life.children.length > 0 || life.messages.length > 0));

/** « 15,5 » et « /20 » (le barème à part, plus discret) ; une note spéciale (« Abs ») n'a pas de barème. */
export function gradeParts(grade: SchoolGrade): { value: string; outOf: string } {
  const numeric = /^-?\d+(,\d+)?$/u.test(grade.value);
  return { value: grade.value, outOf: numeric && grade.outOf !== null ? `/${grade.outOf}` : '' };
}

/** « 1 absence · 1 retard », « Aucune absence » */
export function attendanceText(summary: Pick<ChildSummary, 'absences' | 'delays'>): string {
  const parts = [
    summary.absences > 0 && pluralize(summary.absences, 'absence'),
    summary.delays > 0 && pluralize(summary.delays, 'retard'),
  ].filter((p) => p !== false);
  return parts.length ? parts.join(' · ') : 'Ni absence ni retard';
}

export const toJustifyText = (count: number) => `${count} à justifier`;

const weekdayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const shortFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** Jour passé : « aujourd’hui », « hier », « lundi » (cette semaine), « 23 oct. ». */
export function pastDayText(day: string, now: Date): string {
  const date = parseDay(day);
  const diff = dayDiff(date, now);
  if (diff === 0) return 'aujourd’hui';
  if (diff === 1) return 'hier';
  if (diff > 1 && diff < 7) return weekdayFormat.format(date);
  return shortFormat.format(date);
}

/** « Retard · 10 minutes », « Absence · 1 demi-journée » */
export const attendanceTitle = (a: SchoolAttendance) => `${a.kind === 'absence' ? 'Absence' : 'Retard'} · ${a.duration}`;

/** « Justifiée · rendez-vous médical », « À justifier » */
export function attendanceStatus(a: SchoolAttendance): string {
  if (!a.justified) return 'À justifier';
  const done = a.kind === 'absence' ? 'Justifiée' : 'Justifié';
  return a.reason ? `${done} · ${a.reason.charAt(0).toLowerCase()}${a.reason.slice(1)}` : done;
}

/** « 2 messages non lus », « Aucun message non lu » */
export const unreadText = (count: number) => (count === 0 ? 'Aucun message non lu' : `${pluralize(count, 'message')} non ${count > 1 ? 'lus' : 'lu'}`);

/** Jour d'un message (ISO) : comme `pastDayText`, avec une majuscule pour commencer une ligne. */
export const messageDayText = (iso: string, now: Date, upper = false) => {
  const d = new Date(iso);
  const text = pastDayText(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, now);
  return upper ? capitalize(text) : text;
};
