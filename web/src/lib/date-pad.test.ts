// Tests du pavé de date : chiffres tapés, jour et mois (année devinée), mois et année d'une DDM, indications.
import { describe, expect, it } from 'vitest';
import { digitsOf, padDate, padDisplay, padHint, typeDigit } from './date-pad.ts';

const TODAY = '2026-11-05';

describe('pavé de date', () => {
  it('quatre chiffres au plus, affichés en deux groupes', () => {
    let digits = '';
    for (const d of ['0', '9', '1', '1', '5', 'x']) digits = typeDigit(digits, d);
    expect(digits).toBe('0911');
    expect(padDisplay(digits)).toBe('09 / 11');
    expect(padDisplay('0')).toBe('0_ / __');
    expect(digitsOf('2026-11-09')).toBe('0911');
    expect(digitsOf(null)).toBe('');
  });

  it('jour et mois : l’année se devine ; mois et année : dernier jour du mois', () => {
    expect(padDate('0911', 'day', TODAY)).toBe('2026-11-09');
    expect(padDate('1503', 'day', TODAY)).toBe('2027-03-15');
    expect(padDate('3102', 'day', TODAY)).toBeNull();
    expect(padDate('0913', 'day', TODAY)).toBeNull();
    expect(padDate('091', 'day', TODAY)).toBeNull();
    expect(padDate('0327', 'month', TODAY)).toBe('2027-03-31');
    expect(padDate('1327', 'month', TODAY)).toBeNull();
  });

  it('dit la date entière et dans combien de jours', () => {
    expect(padHint('0911', 'day', TODAY)).toBe('lundi 9 novembre 2026 · dans 4 jours');
    expect(padHint('0611', 'day', TODAY)).toBe('vendredi 6 novembre 2026 · demain');
    expect(padHint('09', 'day', TODAY)).toBe('Jour puis mois');
    expect(padHint('3102', 'day', TODAY)).toBe('Date impossible');
  });
});
