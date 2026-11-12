// Tests des produits sans code-barres : quantité avec unité ↔ unités du stock et contenance.
import { describe, expect, it } from 'vitest';
import { containerCode, isLooseCode, looseCode, looseNumber } from './barcode.ts';
import { formatLoose, looseAmount, looseStock, validLooseAmount } from './loose.ts';
import { stockPool } from './menu.ts';
import { parsePackage } from './quantities.ts';
import { guessStockLink } from './stock-link.ts';

describe('produits sans code-barres', () => {
  it('identifiant interne : préfixe 28, clé juste, distinct des contenants', () => {
    expect(looseCode(1)).toMatch(/^280000000001\d$/u);
    expect(isLooseCode(looseCode(42))).toBe(true);
    expect(looseNumber(looseCode(42))).toBe(42);
    expect(isLooseCode(containerCode(1))).toBe(false);
    expect(isLooseCode('3560070446117')).toBe(false);
  });

  it('ce qui se pèse : une unité, toute la quantité en contenance', () => {
    expect(looseStock(1.2, 'kg')).toEqual({ count: 1, quantity: '1,2 kg' });
    expect(looseStock(750, 'g')).toEqual({ count: 1, quantity: '750 g' });
    expect(parsePackage(looseStock(1.2, 'kg').quantity)).toEqual({ quantity: 1.2, unit: 'kg' });
  });

  it('ce qui se compte : une unité par pièce, que le menu relie aux ingrédients', () => {
    expect(looseStock(6, 'piece')).toEqual({ count: 6, quantity: '1 pièce' });
    expect(looseStock(2, 'botte')).toEqual({ count: 2, quantity: '1 botte' });
    expect(parsePackage('1 pièce')).toEqual({ quantity: 1, unit: 'piece' });
    expect(parsePackage('1 botte')).toEqual({ quantity: 1, unit: 'botte' });
    expect(parsePackage('2 barquettes')).toEqual({ quantity: 2, unit: 'barquette' });
  });

  it('ce qu’on a en tout, et son affichage', () => {
    expect(looseAmount('1,2 kg', 1)).toEqual({ amount: 1.2, unit: 'kg' });
    expect(looseAmount('1 pièce', 6)).toEqual({ amount: 6, unit: 'piece' });
    expect(looseAmount('format familial', 1)).toBeNull();
    expect(looseAmount(null, 1)).toBeNull();
    expect(formatLoose({ amount: 1.2, unit: 'kg' })).toBe('1,2 kg');
    expect(formatLoose({ amount: 1, unit: 'piece' })).toBe('1 pièce');
    expect(formatLoose({ amount: 6, unit: 'piece' })).toBe('6 pièces');
    expect(formatLoose({ amount: 2, unit: 'botte' })).toBe('2 bottes');
    expect(formatLoose({ amount: 0, unit: 'kg' })).toBe('');
  });

  it('quantité acceptable', () => {
    expect(validLooseAmount(1.2, 'kg')).toBe(true);
    expect(validLooseAmount(2.5, 'piece')).toBe(false);
    expect(validLooseAmount(0, 'g')).toBe(false);
    expect(validLooseAmount(100, 'piece')).toBe(false);
    expect(validLooseAmount(Number.NaN, 'kg')).toBe(false);
  });

  it('relié aux ingrédients du menu comme un paquet scanné', () => {
    const radis = guessStockLink({ name: 'Radis', ...looseStock(2, 'botte'), category: 'Fruits et légumes' }, [{ key: 'radis', name: 'radis' }]);
    expect(radis).toEqual({ key: 'radis', name: 'radis', per: { quantity: 1, unit: 'botte' } });
    const pommes = guessStockLink({ name: 'Pommes', quantity: looseStock(1.2, 'kg').quantity, category: 'Fruits et légumes' }, [{ key: 'pomme', name: 'pomme' }]);
    expect(pommes?.per).toEqual({ quantity: 1.2, unit: 'kg' });
    const pool = stockPool([
      { name: 'Radis', count: 2, link: radis },
      { name: 'Pommes', count: 1, link: pommes },
    ]);
    expect(pool.get('radis')?.quantities).toEqual({ botte: 2 });
    expect(pool.get('pomme')?.quantities).toEqual({ masse: 1200 });
  });
});
