// Tests de la correspondance devinée entre un produit du stock et un ingrédient.
import { describe, expect, it } from 'vitest';
import { guessStockLink, nameWords } from './stock-link.ts';

const KNOWN = [
  { key: 'lait', name: 'lait' },
  { key: 'lait-de-coco', name: 'lait de coco' },
  { key: 'lardon', name: 'lardon' },
  { key: 'pate', name: 'pâte' },
];
const product = (name: string, quantity: string | null, category: string | null = null) => ({ name, quantity, category });

describe('nameWords', () => {
  it('mots au singulier, sans accents ni petits mots', () => {
    expect(nameWords('Lardons fumés')).toEqual(['lardon', 'fume']);
    expect(nameWords('Lait de coco 400 ml')).toEqual(['lait', 'coco', 'ml']);
  });
});

describe('guessStockLink', () => {
  it('relie par les mots du nom et lit la contenance', () => {
    expect(guessStockLink(product('Lardons fumés', '2 x 75 g'), KNOWN)).toEqual({ key: 'lardon', name: 'lardon', per: { quantity: 150, unit: 'g' } });
    expect(guessStockLink(product('Lait demi-écrémé', '1 L'), KNOWN)).toEqual({ key: 'lait', name: 'lait', per: { quantity: 1, unit: 'l' } });
  });

  it('préfère l’ingrédient le plus précis', () => {
    expect(guessStockLink(product('Lait de coco bio', '400 ml'), KNOWN)?.key).toBe('lait-de-coco');
  });

  it('à défaut, le premier mot s’il a un rayon connu', () => {
    expect(guessStockLink(product('Riz basmati', '1 kg'), KNOWN)).toEqual({ key: 'riz', name: 'riz', per: { quantity: 1, unit: 'kg' } });
    expect(guessStockLink(product('Coquillettes', '500 g'), KNOWN)?.key).toBe('coquillette');
    expect(guessStockLink(product('Café moulu', '250 g'), KNOWN)).toMatchObject({ key: 'cafe', name: 'café' });
  });

  it('rien pour ce qui ne se mange pas, ou sans idée', () => {
    expect(guessStockLink(product('Lessive liquide', '1,5 L'), KNOWN)).toBeNull();
    expect(guessStockLink(product('Lait corporel', '250 ml', 'Hygiène'), KNOWN)).toBeNull();
    expect(guessStockLink(product('Shampooing doux', '250 ml'), KNOWN)).toBeNull();
  });

  it('contenance illisible : relié quand même, quantité inconnue', () => {
    expect(guessStockLink(product('Lardons', null), KNOWN)).toEqual({ key: 'lardon', name: 'lardon', per: null });
  });
});
