// Tests du calcul des jours fériés : Pâques et les fêtes mobiles sur plusieurs années, dates fixes, recherche d'un jour.
import { describe, expect, it } from 'vitest';
import { easterSunday, isPublicHoliday, publicHolidayOn, publicHolidaysOf } from './public-holidays.ts';

describe('jours fériés', () => {
  it('Pâques : dates connues, y compris les extrêmes (22 mars, 25 avril)', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2038)).toBe('2038-04-25');
    expect(easterSunday(2285)).toBe('2285-03-22');
  });

  it('les 11 jours de 2027, dans l’ordre, fêtes mobiles comprises', () => {
    expect(publicHolidaysOf(2027)).toEqual([
      { day: '2027-01-01', name: '1er janvier' },
      { day: '2027-03-29', name: 'lundi de Pâques' },
      { day: '2027-05-01', name: '1er mai' },
      { day: '2027-05-06', name: 'Ascension' },
      { day: '2027-05-08', name: '8 mai' },
      { day: '2027-05-17', name: 'lundi de Pentecôte' },
      { day: '2027-07-14', name: '14 juillet' },
      { day: '2027-08-15', name: '15 août' },
      { day: '2027-11-01', name: 'Toussaint' },
      { day: '2027-11-11', name: '11 novembre' },
      { day: '2027-12-25', name: 'Noël' },
    ]);
  });

  it('fêtes mobiles 2026 (calendrier officiel)', () => {
    expect(publicHolidayOn('2026-04-06')?.name).toBe('lundi de Pâques');
    expect(publicHolidayOn('2026-05-14')?.name).toBe('Ascension');
    expect(publicHolidayOn('2026-05-25')?.name).toBe('lundi de Pentecôte');
  });

  it('un jour ordinaire n’est pas férié', () => {
    expect(isPublicHoliday('2026-11-11')).toBe(true);
    expect(isPublicHoliday('2026-11-10')).toBe(false);
    expect(isPublicHoliday('2026-04-05')).toBe(false); // dimanche de Pâques : pas dans la liste légale
    expect(publicHolidayOn('2026-12-26')).toBeUndefined();
  });
});
