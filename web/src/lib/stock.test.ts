import { describe, expect, it } from 'vitest';
import type { Product } from '../../../shared/types.ts';
import { infoDiff, productDetail, provenance, stockText } from './stock.ts';

const product = (over: Partial<Product['current']> = {}, versionCount = 1): Product => ({
  code: '3560070446117',
  current: { name: 'Purée de pomme', brand: 'Carrefour Kids', quantity: '4 x 90 g', category: null, from: '2026-11-05T10:00:00Z', source: 'base', base: 'open-food-facts', ...over },
  versionCount,
  image: null,
  autoShop: null,
  refill: null,
  conflict: null,
  baseReadAt: null,
});

describe('libellés du stock', () => {
  it('dit d’où vient la fiche', () => {
    expect(provenance(product())).toBe('Lu dans Open Food Facts le 5 novembre 2026');
    expect(provenance(product({ source: 'manual', base: null }))).toBe('Saisi à la main le 5 novembre 2026');
    expect(provenance(product({ source: 'manual', base: null }, 2))).toBe('Corrigé à la main le 5 novembre 2026 · 2 versions');
  });

  it('montre les champs qui diffèrent de la base', () => {
    const mine = product().current;
    expect(infoDiff(mine, { ...mine, quantity: '4 x 85 g', brand: null })).toEqual([
      { label: 'Marque', mine: 'Carrefour Kids', theirs: '—' },
      { label: 'Contenance', mine: '4 x 90 g', theirs: '4 x 85 g' },
    ]);
    expect(infoDiff(mine, mine)).toEqual([]);
  });

  it('résume marque, contenance et quantité', () => {
    expect(productDetail({ brand: 'X', quantity: null })).toBe('X');
    expect(stockText(0)).toBe('Épuisé');
    expect(stockText(2)).toBe('2 en stock');
  });
});
