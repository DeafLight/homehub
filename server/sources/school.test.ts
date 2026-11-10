// Tests de la mise en forme commune aux sources scolaires : matières, prénoms.
import { describe, expect, it } from 'vitest';
import { formatSubject, normalizeName } from './school.ts';

describe('sources scolaires', () => {
  it('met en forme les matières', () => {
    expect(formatSubject('SCIENCES VIE & TERRE')).toBe('Sciences vie & terre');
    expect(formatSubject('ANGLAIS LV1')).toBe('Anglais LV1');
    expect(formatSubject('  histoire   géo ')).toBe('Histoire géo');
  });

  it('compare les prénoms sans accents ni majuscules', () => {
    expect(normalizeName(' Léa ')).toBe('lea');
    expect(normalizeName('LÉA')).toBe(normalizeName('lea'));
    expect(normalizeName('Tom')).not.toBe(normalizeName('Tim'));
  });
});
