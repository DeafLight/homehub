// Heure du coucher des enfants (fonction 16 de l'appli HomeHub TV, docs/appli-tele.md) : règles pures, communes au
// serveur et au front. Une heure par soir de la semaine, dans deux tableaux : période d'école et vacances. Le tableau
// des vacances sert les soirs dont le lendemain est sans école pour une autre raison que le week-end (vacances
// scolaires, jour férié) : le vendredi qui ouvre les vacances en profite, le dimanche de la rentrée reprend l'heure
// d'école. Trois temps sur les télés allumées : un rappel (bandeau, quelques minutes avant), la pause de ce qui passe
// à l'heure dite (bandeau « C'est l'heure d'aller au lit »), puis l'écran de veille HomeHub. Un parent peut repousser
// l'heure ou annuler pour ce soir depuis son téléphone. Rien de personnel à l'écran : des prénoms et une heure.
import { isNoSchoolDay, type SchoolHoliday, shiftDay, weekdayOf } from './school-holidays.ts';
import { tvTitle } from './tv.ts';

/** Les trois temps du coucher, dans l'ordre. */
export const BEDTIME_STAGES = ['reminder', 'pause', 'sleep'] as const;
export type BedtimeStage = (typeof BEDTIME_STAGES)[number];

/** Tableau des heures : période d'école, ou vacances. */
export const BEDTIME_SCHEDULES = ['school', 'holidays'] as const;
export type BedtimeSchedule = (typeof BEDTIME_SCHEDULES)[number];

/** Une heure HH:MM par soir, indice 0 = dimanche … 6 = samedi ; null : pas de coucher ce soir-là. */
export type BedtimeWeek = (string | null)[];

export type BedtimeSettings = {
  enabled: boolean;
  school: BedtimeWeek;
  holidays: BedtimeWeek;
  /** Minutes entre le rappel et l'heure du coucher. */
  reminderMin: number;
  /** Minutes entre la pause et l'écran de veille. */
  sleepMin: number;
};

/** Heures permises : le soir, assez tôt pour que l'écran de veille et un report restent avant minuit. */
export const BEDTIME_EARLIEST = '17:00';
export const BEDTIME_LATEST = '22:30';
export const BEDTIME_REMINDER_CHOICES = [5, 10, 15, 20, 30] as const;
export const BEDTIME_SLEEP_CHOICES = [0, 5, 10, 15, 20, 30] as const;
/** Pas d'un report et report total permis pour un soir. */
export const BEDTIME_POSTPONE_STEP_MIN = 15;
export const BEDTIME_POSTPONE_MAX_MIN = 60;
/** Une télé allumée dans la demi-heure qui suit un temps le reçoit encore ; au-delà, il est passé. */
export const BEDTIME_CATCH_UP_MIN = 30;
/** Durée des bandeaux du coucher sur la télé. */
export const BEDTIME_BANNER_SECONDS = 20;

/** Réglages tant que rien n'est enregistré : coupé (la pause du soir ne doit surprendre personne). */
export const BEDTIME_DEFAULTS: BedtimeSettings = {
  enabled: false,
  //        dim      lun      mar      mer      jeu      ven      sam
  school: ['20:30', '20:30', '20:30', '20:30', '20:30', '21:00', '21:00'],
  holidays: ['21:30', '21:30', '21:30', '21:30', '21:30', '21:30', '21:30'],
  reminderMin: 15,
  sleepMin: 10,
};

/** Soirs dans l'ordre de la page de réglage (lundi d'abord), avec leur indice de BedtimeWeek. */
export const BEDTIME_DAYS: { index: number; short: string; name: string }[] = [
  { index: 1, short: 'Lun', name: 'lundi' },
  { index: 2, short: 'Mar', name: 'mardi' },
  { index: 3, short: 'Mer', name: 'mercredi' },
  { index: 4, short: 'Jeu', name: 'jeudi' },
  { index: 5, short: 'Ven', name: 'vendredi' },
  { index: 6, short: 'Sam', name: 'samedi' },
  { index: 0, short: 'Dim', name: 'dimanche' },
];

export const BEDTIME_SCHEDULE_LABELS: Record<BedtimeSchedule, string> = { school: 'Période d’école', holidays: 'Veilles de vacances' };

/**
 * Où en est le coucher de ce soir. `off` : réglage coupé ou pas de coucher ce soir ; `cancelled` : annulé par un
 * parent ; sinon le dernier temps passé (`before` : avant le rappel).
 */
export type BedtimeState = 'off' | 'cancelled' | 'before' | BedtimeStage;

/** Le coucher de ce soir, pour la tablette et le téléphone d'un parent. */
export type BedtimeTonight = {
  day: string;
  schedule: BedtimeSchedule;
  /** Heure prévue par le réglage, ou null. */
  planned: string | null;
  /** Report décidé ce soir, en minutes. */
  delayMin: number;
  /** Heure retenue (prévue + report), ou null. */
  time: string | null;
  state: BedtimeState;
  /** Heure de chaque temps, ou null sans coucher ce soir. */
  stages: Record<BedtimeStage, string> | null;
  /** Un report de BEDTIME_POSTPONE_STEP_MIN est encore permis. */
  canPostpone: boolean;
};

export type BedtimeView = { settings: BedtimeSettings; tonight: BedtimeTonight };

/** Le bandeau du rappel, ou d'un changement décidé par un parent. */
export type BedtimeText = { title: string; subtitle: string };

/** Écran de veille du coucher (`sleep`), ou fermeture de cet écran (`wake` : coucher repoussé ou annulé). */
export type ScreenBedtimeEvent = { kind: 'bedtime'; id: string; action: 'sleep' | 'wake' };

export const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

export const fromMinutes = (minutes: number) => {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const addMinutes = (time: string, minutes: number) => fromMinutes(toMinutes(time) + minutes);

/** Tableau à suivre le soir `day` : vacances si le lendemain est sans école (hors week-end), sinon école. */
export function scheduleOf(holidays: readonly SchoolHoliday[], day: string): BedtimeSchedule {
  return isNoSchoolDay(holidays, shiftDay(day, 1)) ? 'holidays' : 'school';
}

/** Heure de chaque temps pour un coucher à `time`. */
export function stageTimes(time: string, settings: Pick<BedtimeSettings, 'reminderMin' | 'sleepMin'>): Record<BedtimeStage, string> {
  return { reminder: addMinutes(time, -settings.reminderMin), pause: time, sleep: addMinutes(time, settings.sleepMin) };
}

/** Indice du dernier temps passé à `nowMin` (minutes depuis minuit), -1 avant le rappel. */
export function passedStage(stages: Record<BedtimeStage, string>, nowMin: number): number {
  let index = -1;
  BEDTIME_STAGES.forEach((stage, i) => {
    if (toMinutes(stages[stage]) <= nowMin) index = i;
  });
  return index;
}

/**
 * Le temps à envoyer maintenant, ou null : le dernier temps passé, s'il l'est depuis moins de BEDTIME_CATCH_UP_MIN et
 * qu'il n'a pas déjà été envoyé (lui ou un suivant : `sent` est l'indice du dernier temps envoyé, -1 aucun). Une télé
 * allumée après la pause ne reçoit pas le rappel, seulement la pause.
 */
export function dueStage(stages: Record<BedtimeStage, string>, nowMin: number, sent: number): BedtimeStage | null {
  const index = passedStage(stages, nowMin);
  if (index < 0 || index <= sent) return null;
  const stage = BEDTIME_STAGES[index];
  return nowMin - toMinutes(stages[stage]) < BEDTIME_CATCH_UP_MIN ? stage : null;
}

/** Le coucher du soir `day` à `nowMin`, avec le report et l'annulation décidés ce soir. */
export function bedtimeTonight({
  settings,
  holidays,
  day,
  nowMin,
  delayMin,
  cancelled,
}: {
  settings: BedtimeSettings;
  holidays: readonly SchoolHoliday[];
  day: string;
  nowMin: number;
  delayMin: number;
  cancelled: boolean;
}): BedtimeTonight {
  const schedule = scheduleOf(holidays, day);
  const planned = settings[schedule][weekdayOf(day)] ?? null;
  const time = planned && addMinutes(planned, delayMin);
  const stages = time ? stageTimes(time, settings) : null;
  const state: BedtimeState = !settings.enabled || !stages ? 'off' : cancelled ? 'cancelled' : (['before', ...BEDTIME_STAGES] as const)[passedStage(stages, nowMin) + 1];
  const canPostpone =
    settings.enabled && !cancelled && planned !== null && delayMin + BEDTIME_POSTPONE_STEP_MIN <= BEDTIME_POSTPONE_MAX_MIN;
  return { day, schedule, planned, delayMin, time, state, stages, canPostpone };
}

/** « Léa et Tom », « Léa, Tom et Zoé » ; vide sans enfant. */
export function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/** Bandeau du rappel : « Coucher dans 15 min », « Léa et Tom : au lit à 20:30 ». */
export function bedtimeReminderText(children: readonly string[], time: string, nowMin: number): BedtimeText {
  const left = Math.max(1, toMinutes(time) - nowMin);
  const names = namesList(children);
  return { title: `Coucher dans ${left} min`, subtitle: names ? `${names} : au lit à ${time}` : `Au lit à ${time}` };
}

/** Bandeau de la pause : « C'est l'heure d'aller au lit », « Bonne nuit Léa et Tom ! ». */
export function bedtimePauseText(children: readonly string[]): BedtimeText {
  const names = namesList(children);
  return { title: 'C’est l’heure d’aller au lit', subtitle: names ? `Bonne nuit ${names} !` : 'Bonne nuit !' };
}

/** Bandeau d'un changement décidé par un parent (« De la part d'Alex », ou « HomeHub » sans auteur). */
export function bedtimeChangeText(change: 'postponed' | 'cancelled' | 'restored', time: string | null, sender: string | null): BedtimeText {
  const subtitle = sender ? tvTitle(sender).replace(/^Message /u, 'De la part ') : 'HomeHub';
  if (change === 'cancelled') return { title: 'Pas de coucher imposé ce soir', subtitle };
  if (change === 'restored') return { title: `Coucher rétabli à ${time}`, subtitle };
  return { title: `Coucher repoussé à ${time}`, subtitle };
}

/** Réglages complets : ce qui manque ou est mal formé est pris aux valeurs par défaut. */
export function bedtimeWithDefaults(saved: Partial<BedtimeSettings> | undefined): BedtimeSettings {
  const week = (value: BedtimeWeek | undefined, fallback: BedtimeWeek) => (value?.length === 7 ? value : fallback);
  return {
    enabled: saved?.enabled ?? BEDTIME_DEFAULTS.enabled,
    school: week(saved?.school, BEDTIME_DEFAULTS.school),
    holidays: week(saved?.holidays, BEDTIME_DEFAULTS.holidays),
    reminderMin: saved?.reminderMin ?? BEDTIME_DEFAULTS.reminderMin,
    sleepMin: saved?.sleepMin ?? BEDTIME_DEFAULTS.sleepMin,
  };
}
