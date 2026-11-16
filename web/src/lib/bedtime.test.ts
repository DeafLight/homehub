// Tests du coucher côté front : phrase de ce soir selon l'état, boutons permis, soir modifié dans un tableau.
import { describe, expect, it } from 'vitest';
import { BEDTIME_DEFAULTS, bedtimeTonight, toMinutes } from '../../../shared/bedtime.ts';
import { tonightActions, tonightLine, withDay } from './bedtime.ts';

const settings = { ...BEDTIME_DEFAULTS, enabled: true };
const tonight = (time: string, over: { delayMin?: number; cancelled?: boolean } = {}) =>
  bedtimeTonight({ settings, holidays: [], day: '2026-11-16', nowMin: toMinutes(time), delayMin: 0, cancelled: false, ...over });

describe('ce soir', () => {
  it('dit où en est le coucher', () => {
    expect(tonightLine(settings, tonight('19:00'))).toEqual({ text: 'Au lit à 20:30 : rappel à 20:15, écran de veille à 20:40', detail: 'période d’école' });
    expect(tonightLine(settings, tonight('20:20')).text).toBe('Rappel affiché : au lit à 20:30');
    expect(tonightLine(settings, tonight('20:35')).text).toBe('Télé en pause depuis 20:30 : écran de veille à 20:40');
    expect(tonightLine(settings, tonight('21:00', { delayMin: 15 }))).toEqual({ text: 'Écran de veille depuis 20:55 (coucher de 20:45)', detail: 'période d’école · repoussé de 15 min' });
    expect(tonightLine(settings, tonight('19:00', { cancelled: true })).text).toBe('Pas de coucher ce soir : annulé par un parent');
    expect(tonightLine(BEDTIME_DEFAULTS, tonight('19:00')).text).toBe('Coucher coupé : rien ne se passe sur la télé');
  });

  it('boutons permis', () => {
    expect(tonightActions(tonight('19:00'))).toEqual({ postpone: '+15 min', cancel: true, restore: false });
    expect(tonightActions(tonight('19:00', { delayMin: 60 }))).toEqual({ postpone: null, cancel: true, restore: true });
    expect(tonightActions(tonight('19:00', { cancelled: true }))).toEqual({ postpone: null, cancel: false, restore: true });
  });
});

describe('tableau des heures', () => {
  it('un soir changé, effacé ou hors du soir', () => {
    const week = BEDTIME_DEFAULTS.school;
    expect(withDay(week, 5, '21:15')[5]).toBe('21:15');
    expect(withDay(week, 5, '')[5]).toBeNull();
    expect(withDay(week, 5, '07:30')[5]).toBeNull();
    expect(withDay(week, 5, '21:15').filter((t, i) => i !== 5)).toEqual(week.filter((_, i) => i !== 5));
  });
});
