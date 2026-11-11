// Tests de la mise en forme commune aux sources scolaires : matières, prénoms.
import { describe, expect, it } from 'vitest';
import { formatSubject, normalizeName } from './school.ts';

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
});
