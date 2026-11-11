// Tests de ce qu'on dit des vacances scolaires et des jours fériés chaque jour : avant, dernier jour, pendant, reprise, été, veille d'un férié.
import { describe, expect, it } from 'vitest';
import {
  type SchoolHoliday,
  formatHolidayDay,
  holidayStatus,
  holidayText,
  isHolidayDay,
  isNoSchoolDay,
  lastSchoolDayBefore,
} from './school-holidays.ts';

// Zone B, 2026-2027 (dates du calendrier officiel).
const HOLIDAYS: SchoolHoliday[] = [
  { name: 'Vacances de la Toussaint', start: '2026-10-17', end: '2026-11-02' },
  { name: 'Vacances de Noël', start: '2026-12-19', end: '2027-01-04' },
  { name: 'Vacances d’hiver', start: '2027-02-20', end: '2027-03-08' },
  { name: 'Pont de l’Ascension', start: '2027-05-07', end: '2027-05-10' },
  { name: 'Vacances d’été', start: '2027-07-03', end: '2027-09-02' },
];
const text = (today: string) => {
  const status = holidayStatus(HOLIDAYS, today);
  return status && holidayText(status);
};

describe('vacances scolaires : ce qu’on en dit', () => {
  it('rien plus de 3 semaines avant, puis le compte des jours', () => {
    expect(text('2026-11-05')).toBeNull();
    expect(text('2026-11-27')).toBeNull(); // 22 jours
    expect(text('2026-11-28')).toBe('Vacances de Noël dans 21 jours');
    expect(text('2026-12-07')).toBe('Vacances de Noël dans 12 jours');
    expect(holidayStatus(HOLIDAYS, '2026-12-07')).toEqual({ kind: 'soon', name: 'Vacances de Noël', start: '2026-12-19', days: 12 });
  });

  it('le dernier jour de classe (vendredi), puis les vacances avec le jour de la reprise', () => {
    expect(text('2026-12-18')).toBe('Dernier jour avant les vacances de Noël');
    expect(text('2026-12-19')).toBe('Vacances de Noël · reprise lundi 4 janvier');
    expect(text('2027-01-03')).toBe('Vacances de Noël · reprise lundi 4 janvier');
  });

  it('le jour de la reprise : plus rien', () => {
    expect(holidayStatus(HOLIDAYS, '2027-01-04')).toBeNull();
    expect(holidayStatus(HOLIDAYS, '2026-11-02')).toBeNull();
  });

  it('un pont : article « le », reprise le lundi', () => {
    expect(text('2027-05-05')).toBe('Dernier jour avant le pont de l’Ascension'); // jeudi 6 : Ascension, férié
    expect(text('2027-05-06')).toBe('Férié · Ascension');
    expect(text('2027-05-08')).toBe('Pont de l’Ascension · reprise lundi 10 mai');
  });

  it('l’été : dernier jour, vacances, « 1er » du mois', () => {
    expect(text('2027-07-02')).toBe('Dernier jour avant les vacances d’été');
    expect(text('2027-08-15')).toBe('Vacances d’été · reprise jeudi 2 septembre');
    expect(formatHolidayDay('2026-09-01')).toBe('mardi 1er septembre');
  });

  it('veille des vacances un week-end ou en pleine semaine : on compte, « demain »', () => {
    const odd: SchoolHoliday[] = [{ name: 'Vacances de printemps', start: '2027-04-15', end: '2027-05-03' }]; // un jeudi
    expect(lastSchoolDayBefore('2027-04-15')).toBe('2027-04-14');
    expect(holidayText(holidayStatus(odd, '2027-04-14')!)).toBe('Dernier jour avant les vacances de printemps');
    expect(lastSchoolDayBefore('2027-04-19')).toBe('2027-04-16'); // lundi → vendredi
    const monday: SchoolHoliday[] = [{ name: 'Vacances de printemps', start: '2027-04-19', end: '2027-05-03' }];
    expect(holidayText(holidayStatus(monday, '2027-04-18')!)).toBe('Vacances de printemps demain');
  });

  it('reprise inconnue : vacances sans date de reprise, pendant 70 jours au plus', () => {
    const unknown: SchoolHoliday[] = [{ name: 'Vacances d’été', start: '2028-07-04', end: null }];
    expect(holidayText(holidayStatus(unknown, '2028-07-10')!)).toBe('Vacances d’été');
    expect(isHolidayDay(unknown, '2028-09-11')).toBe(true);
    expect(isHolidayDay(unknown, '2028-09-12')).toBe(false);
  });

  it('sans données ou après la dernière période connue : rien (hors jours fériés)', () => {
    expect(holidayStatus(null, '2026-12-18')).toBeNull();
    expect(holidayStatus(null, '2026-11-11')).toEqual({ kind: 'public-holiday', name: '11 novembre', day: '2026-11-11' });
    expect(holidayStatus([], '2026-12-18')).toBeNull();
    expect(holidayStatus(HOLIDAYS, '2027-10-01')).toBeNull();
  });

  it('jours de vacances : week-ends compris, reprise exclue', () => {
    expect(isHolidayDay(HOLIDAYS, '2026-12-18')).toBe(false);
    expect(isHolidayDay(HOLIDAYS, '2026-12-19')).toBe(true);
    expect(isHolidayDay(HOLIDAYS, '2026-12-25')).toBe(true);
    expect(isHolidayDay(HOLIDAYS, '2027-01-04')).toBe(false);
  });
});

describe('jours fériés : ce qu’on en dit', () => {
  it('le jour même, puis la veille (« Demain », ou le jour un vendredi)', () => {
    expect(text('2026-11-11')).toBe('Férié · 11 novembre');
    expect(text('2026-11-10')).toBe('Demain férié · 11 novembre');
    expect(holidayStatus(HOLIDAYS, '2026-11-10')).toEqual({ kind: 'public-holiday-next', name: '11 novembre', day: '2026-11-11', days: 1 });
    expect(text('2027-03-26')).toBe('Lundi férié · lundi de Pâques'); // vendredi
    expect(text('2027-03-27')).toBe('Lundi férié · lundi de Pâques'); // samedi
    expect(text('2027-03-29')).toBe('Férié · lundi de Pâques');
    expect(text('2027-05-14')).toBe('Lundi férié · lundi de Pentecôte');
  });

  it('pendant les vacances, les vacances l’emportent ; un férié pendant les vacances n’est pas annoncé', () => {
    expect(text('2026-12-25')).toBe('Vacances de Noël · reprise lundi 4 janvier');
    expect(text('2026-12-24')).toBe('Vacances de Noël · reprise lundi 4 janvier');
    expect(text('2026-10-31')).toBe('Vacances de la Toussaint · reprise lundi 2 novembre');
  });

  it('un férié un samedi ou un dimanche n’annonce rien la veille', () => {
    // Vendredi 13 août 2027 : le 15 août tombe un dimanche, lundi 16 n’est pas férié (et c’est l’été).
    expect(holidayStatus([], '2027-08-13')).toBeNull();
    // Vendredi 7 mai 2027 hors vacances : samedi 8 mai férié, lundi 10 ordinaire.
    expect(holidayStatus([], '2027-05-07')).toBeNull();
  });

  it('dernier jour de classe : un vendredi férié est sauté', () => {
    // 1er mai 2026, vendredi : vacances qui commenceraient le samedi 2.
    expect(lastSchoolDayBefore('2026-05-02')).toBe('2026-04-30');
  });

  it('jours sans école : vacances ou fériés, pas les jours ordinaires', () => {
    expect(isNoSchoolDay(HOLIDAYS, '2026-11-11')).toBe(true);
    expect(isNoSchoolDay(HOLIDAYS, '2026-12-21')).toBe(true);
    expect(isNoSchoolDay(HOLIDAYS, '2026-11-12')).toBe(false);
    expect(isNoSchoolDay([], '2027-05-17')).toBe(true); // lundi de Pentecôte
  });
});
