// Tests des quantités : conversion par grandeur, somme, différence (et ce qui ne se compare pas), affichage,
// contenance des paquets du stock.
import { describe, expect, it } from 'vitest';
import {
  addQuantities,
  dimensionOf,
  formatAmount,
  formatQuantities,
  isEmpty,
  parsePackage,
  quantitiesOf,
  scaleQuantities,
  subtractQuantities,
} from './quantities.ts';

describe('dimensionOf', () => {
  it('ramène g, kg, cl, l et cuillères à leur base', () => {
    expect(dimensionOf('kg')).toEqual({ dimension: 'masse', factor: 1000 });
    expect(dimensionOf('cl')).toEqual({ dimension: 'volume', factor: 10 });
    expect(dimensionOf('cs')).toEqual({ dimension: 'cuillere', factor: 3 });
    expect(dimensionOf('gousse')).toEqual({ dimension: 'gousse', factor: 1 });
    expect(dimensionOf('piece')).toEqual({ dimension: 'piece', factor: 1 });
  });
});

describe('addQuantities', () => {
  it('additionne ce qui se convertit', () => {
    const q = addQuantities(quantitiesOf(500, 'g'), quantitiesOf(1, 'kg'));
    expect(q).toEqual({ masse: 1500 });
    expect(formatQuantities(q)).toBe('1,5 kg');
    expect(formatQuantities(addQuantities(quantitiesOf(75, 'cl'), quantitiesOf(25, 'cl')))).toBe('1 l');
    expect(formatQuantities(addQuantities(quantitiesOf(1, 'cs'), quantitiesOf(1, 'cc')))).toBe('1 ⅓ c. à s.');
  });

  it('garde côte à côte les unités incompatibles', () => {
    const q = addQuantities(quantitiesOf(2, 'piece'), quantitiesOf(100, 'g'));
    expect(formatQuantities(q)).toBe('2 + 100 g');
    expect(formatQuantities(addQuantities(q, quantitiesOf(3, 'gousse')))).toBe('2 + 100 g + 3 gousses');
  });
});

describe('formatQuantities', () => {
  it('choisit l’unité la plus lisible', () => {
    expect(formatQuantities({ volume: 500 })).toBe('50 cl');
    expect(formatQuantities({ volume: 15 })).toBe('15 ml');
    expect(formatQuantities({ volume: 2500 })).toBe('2,5 l');
    expect(formatQuantities({ cuillere: 1 })).toBe('1 c. à c.');
    expect(formatQuantities({ cuillere: 6 })).toBe('2 c. à s.');
    expect(formatQuantities({ piece: 1.5 })).toBe('1 ½');
    expect(formatQuantities({})).toBe('');
  });
});

describe('scaleQuantities', () => {
  it('met à l’échelle et oublie les zéros', () => {
    expect(scaleQuantities({ masse: 300, piece: 2 }, 1.5)).toEqual({ masse: 450, piece: 3 });
    expect(isEmpty(scaleQuantities({ masse: 300 }, 0))).toBe(true);
  });
});

describe('subtractQuantities', () => {
  it('donne la différence quand les unités le permettent', () => {
    expect(subtractQuantities({ masse: 600 }, { masse: 500 })).toEqual({ rest: { masse: 100 }, uncertain: false });
    expect(subtractQuantities({ volume: 500 }, { volume: 3000 })).toEqual({ rest: {}, uncertain: false });
  });

  it('signale sans trancher ce qui ne se compare pas', () => {
    expect(subtractQuantities({ masse: 150 }, { piece: 1 })).toEqual({ rest: { masse: 150 }, uncertain: true });
    // Les pièces couvertes, les grammes encore dus et une pièce de trop : à vérifier.
    expect(subtractQuantities({ piece: 2, masse: 100 }, { piece: 3 })).toEqual({ rest: { masse: 100 }, uncertain: true });
    // Tout ce qu'on a servi, des grammes encore dus : simplement insuffisant.
    expect(subtractQuantities({ piece: 2, masse: 100 }, { piece: 2 })).toEqual({ rest: { masse: 100 }, uncertain: false });
  });
});

describe('parsePackage', () => {
  it('lit les contenances des étiquettes', () => {
    expect(parsePackage('2 x 75 g')).toEqual({ quantity: 150, unit: 'g' });
    expect(parsePackage('2×75g')).toEqual({ quantity: 150, unit: 'g' });
    expect(parsePackage('1 L')).toEqual({ quantity: 1, unit: 'l' });
    expect(parsePackage('1,5 L')).toEqual({ quantity: 1.5, unit: 'l' });
    expect(parsePackage('6 x 1 L')).toEqual({ quantity: 6, unit: 'l' });
    expect(parsePackage('500 g')).toEqual({ quantity: 500, unit: 'g' });
    expect(parsePackage('250 ml')).toEqual({ quantity: 250, unit: 'ml' });
    expect(parsePackage('1 kg')).toEqual({ quantity: 1, unit: 'kg' });
    expect(parsePackage('x12')).toEqual({ quantity: 12, unit: 'piece' });
    expect(parsePackage('6 œufs')).toEqual({ quantity: 6, unit: 'piece' });
  });

  it('rien de lisible : null', () => {
    expect(parsePackage(null)).toBeNull();
    expect(parsePackage('format familial')).toBeNull();
  });

  it('affiche une contenance', () => {
    expect(formatAmount({ quantity: 150, unit: 'g' })).toBe('150 g');
    expect(formatAmount({ quantity: 1, unit: 'l' })).toBe('1 l');
  });
});
