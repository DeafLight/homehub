// Tests des règles de l'heure du coucher : tableau d'école ou de vacances selon le lendemain, heures des trois temps,
// temps dû (rattrapage, pas de rappel après la pause), coucher de ce soir avec report et annulation, textes.
import { describe, expect, it } from 'vitest';
import {
  BEDTIME_DEFAULTS,
  bedtimeChangeText,
  bedtimePauseText,
  bedtimeReminderText,
  bedtimeTonight,
  bedtimeWithDefaults,
  dueStage,
  namesList,
  scheduleOf,
  stageTimes,
  toMinutes,
} from './bedtime.ts';
import type { SchoolHoliday } from './school-holidays.ts';

// Vacances de Noël fictives : du samedi 19 décembre 2026 au lundi 4 janvier 2027 (reprise).
const NOEL: SchoolHoliday[] = [{ name: 'Vacances de Noël', start: '2026-12-19', end: '2027-01-04' }];
const at = (time: string) => toMinutes(time);

describe('tableau du soir', () => {
  it('école les soirs de semaine et de week-end, vacances la veille d’un jour sans école', () => {
    expect(scheduleOf(NOEL, '2026-12-16')).toBe('school'); // mercredi
    expect(scheduleOf(NOEL, '2026-12-19')).toBe('holidays'); // samedi, pendant les vacances
    expect(scheduleOf([], '2026-12-19')).toBe('school'); // samedi ordinaire : la veille d'un dimanche
    expect(scheduleOf(NOEL, '2026-12-18')).toBe('holidays'); // vendredi : les vacances commencent demain
    expect(scheduleOf(NOEL, '2027-01-03')).toBe('school'); // dimanche de la rentrée
    expect(scheduleOf([], '2026-07-13')).toBe('holidays'); // veille du 14 juillet
  });
});

describe('temps du coucher', () => {
  const stages = stageTimes('20:30', { reminderMin: 15, sleepMin: 10 });

  it('rappel avant, pause à l’heure, écran de veille après', () => {
    expect(stages).toEqual({ reminder: '20:15', pause: '20:30', sleep: '20:40' });
  });

  it('le dernier temps passé, une fois, pendant la demi-heure de rattrapage', () => {
    expect(dueStage(stages, at('20:14'), -1)).toBeNull();
    expect(dueStage(stages, at('20:15'), -1)).toBe('reminder');
    expect(dueStage(stages, at('20:20'), 0)).toBeNull();
    expect(dueStage(stages, at('20:31'), 0)).toBe('pause');
    // Télé allumée à 20 h 32 : la pause seulement, pas le rappel.
    expect(dueStage(stages, at('20:32'), -1)).toBe('pause');
    expect(dueStage(stages, at('20:45'), 1)).toBe('sleep');
    expect(dueStage(stages, at('21:10'), 1)).toBeNull();
    expect(dueStage(stages, at('21:00'), 2)).toBeNull();
  });
});

describe('coucher de ce soir', () => {
  const settings = { ...BEDTIME_DEFAULTS, enabled: true };
  const tonight = (over: Partial<Parameters<typeof bedtimeTonight>[0]> = {}) =>
    bedtimeTonight({ settings, holidays: [], day: '2026-11-16', nowMin: at('19:00'), delayMin: 0, cancelled: false, ...over });

  it('heure du lundi d’école, état selon l’heure', () => {
    expect(tonight()).toMatchObject({ schedule: 'school', planned: '20:30', time: '20:30', state: 'before', canPostpone: true });
    expect(tonight({ nowMin: at('20:20') }).state).toBe('reminder');
    expect(tonight({ nowMin: at('20:35') }).state).toBe('pause');
    expect(tonight({ nowMin: at('22:00') }).state).toBe('sleep');
  });

  it('report par quart d’heure, une heure au plus ; annulation', () => {
    expect(tonight({ delayMin: 15 })).toMatchObject({ time: '20:45', stages: { reminder: '20:30', pause: '20:45', sleep: '20:55' } });
    expect(tonight({ delayMin: 60 }).canPostpone).toBe(false);
    expect(tonight({ cancelled: true })).toMatchObject({ state: 'cancelled', canPostpone: false });
  });

  it('coupé, ou pas de coucher ce soir-là', () => {
    expect(bedtimeTonight({ settings: BEDTIME_DEFAULTS, holidays: [], day: '2026-11-16', nowMin: 0, delayMin: 0, cancelled: false }).state).toBe('off');
    const noMonday = { ...settings, school: settings.school.map((t, i) => (i === 1 ? null : t)) };
    expect(bedtimeTonight({ settings: noMonday, holidays: [], day: '2026-11-16', nowMin: 0, delayMin: 0, cancelled: false })).toMatchObject({ state: 'off', time: null, stages: null });
  });
});

describe('textes', () => {
  it('prénoms des enfants, minutes restantes', () => {
    expect(namesList(['Léa', 'Tom'])).toBe('Léa et Tom');
    expect(namesList(['Léa', 'Tom', 'Zoé'])).toBe('Léa, Tom et Zoé');
    expect(bedtimeReminderText(['Léa', 'Tom'], '20:30', at('20:15'))).toEqual({ title: 'Coucher dans 15 min', subtitle: 'Léa et Tom : au lit à 20:30' });
    expect(bedtimeReminderText([], '20:30', at('20:29'))).toEqual({ title: 'Coucher dans 1 min', subtitle: 'Au lit à 20:30' });
    expect(bedtimePauseText(['Léa'])).toEqual({ title: 'C’est l’heure d’aller au lit', subtitle: 'Bonne nuit Léa !' });
  });

  it('changement décidé par un parent', () => {
    expect(bedtimeChangeText('postponed', '20:45', 'Alex')).toEqual({ title: 'Coucher repoussé à 20:45', subtitle: 'De la part d’Alex' });
    expect(bedtimeChangeText('cancelled', null, 'Sam').subtitle).toBe('De la part de Sam');
    expect(bedtimeChangeText('restored', '20:30', null)).toEqual({ title: 'Coucher rétabli à 20:30', subtitle: 'HomeHub' });
  });
});

describe('réglages', () => {
  it('valeurs par défaut pour ce qui manque', () => {
    expect(bedtimeWithDefaults(undefined)).toEqual(BEDTIME_DEFAULTS);
    expect(bedtimeWithDefaults({ enabled: true, sleepMin: 0 })).toMatchObject({ enabled: true, sleepMin: 0, reminderMin: 15, school: BEDTIME_DEFAULTS.school });
  });
});
