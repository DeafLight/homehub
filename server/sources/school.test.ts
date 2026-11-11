// Tests de la mise en forme commune aux sources scolaires : matières, prénoms, nombres, durées, année scolaire.
import { describe, expect, it } from 'vitest';
import { durationLabel, formatFrenchNumber, formatSubject, normalizeName, parseFrenchNumber, schoolYear } from './school.ts';

describe('sources scolaires', () => {
  it('met en forme les matières', () => {
    expect(formatSubject('SCIENCES VIE & TERRE')).toBe('Sciences vie & terre');
    expect(formatSubject('ANGLAIS LV1')).toBe('Anglais LV1');
    expect(formatSubject('  histoire   géo ')).toBe('Histoire géo');
  });

  it('remet les accents qu’ÉcoleDirecte enlève', () => {
    expect(formatSubject('MATHEMATIQUES')).toBe('Mathématiques');
    expect(formatSubject('FRANCAIS')).toBe('Français');
    expect(formatSubject('HISTOIRE-GEOGRAPHIE')).toBe('Histoire-géographie');
    expect(formatSubject('EDUCATION MUSICALE')).toBe('Éducation musicale');
    expect(formatSubject('SCIENCES ECONOMIQUES ET SOCIALES')).toBe('Sciences économiques et sociales');
    expect(formatSubject('LANGUES ET CULTURES DE L ANTIQUITE')).toBe('Langues et cultures de l antiquité');
  });

  it('garde les sigles en capitales et ne touche pas un nom déjà accentué', () => {
    expect(formatSubject('EPS')).toBe('EPS');
    expect(formatSubject('ENSEIGNEMENT SCIENTIFIQUE SVT')).toBe('Enseignement scientifique SVT');
    expect(formatSubject('Éducation physique et sportive')).toBe('Éducation physique et sportive');
    expect(formatSubject('Français')).toBe('Français');
  });

  it('compare les prénoms sans accents ni majuscules', () => {
    expect(normalizeName(' Léa ')).toBe('lea');
    expect(normalizeName('LÉA')).toBe(normalizeName('lea'));
    expect(normalizeName('Tom')).not.toBe(normalizeName('Tim'));
  });

  it('lit et écrit les nombres à la française', () => {
    expect(parseFrenchNumber('20')).toBe(20);
    expect(parseFrenchNumber(' 14,5 ')).toBe(14.5);
    expect(parseFrenchNumber('7.25')).toBe(7.25);
    expect(parseFrenchNumber(3)).toBe(3);
    expect(parseFrenchNumber('Abs')).toBeNull();
    expect(parseFrenchNumber('')).toBeNull();
    expect(parseFrenchNumber(null)).toBeNull();
    expect(formatFrenchNumber(15.5)).toBe('15,5');
    expect(formatFrenchNumber(12)).toBe('12');
    expect(formatFrenchNumber(13.333)).toBe('13,33');
  });

  it('dit les durées comme à l’oral', () => {
    expect(durationLabel(10)).toBe('10 min');
    expect(durationLabel(120)).toBe('2 h');
    expect(durationLabel(90)).toBe('1 h 30');
    expect(durationLabel(65)).toBe('1 h 05');
  });

  it('donne l’année scolaire, qui commence en août', () => {
    expect(schoolYear(new Date(2026, 10, 2))).toBe('2026-2027');
    expect(schoolYear(new Date(2027, 5, 30))).toBe('2026-2027');
    expect(schoolYear(new Date(2027, 7, 20))).toBe('2027-2028');
  });
});
