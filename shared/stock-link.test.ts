// Tests de la correspondance devinée entre un produit du stock et un ingrédient.
import { describe, expect, it } from 'vitest';
import { guessStock, guessStockLink, nameWords } from './stock-link.ts';

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

describe('guessStock, avec les catégories Open Food Facts', () => {
  const CARNET = [...KNOWN, { key: 'chocolat', name: 'chocolat' }, { key: 'fromage', name: 'fromage' }, { key: 'gruyere', name: 'gruyère' }, { key: 'poulet', name: 'poulet' }];
  const withCategories = (name: string, categories: string[] | null, quantity: string | null = '200 g') => ({ name, quantity, category: null, categories });

  it('le nom l’emporte quand il porte l’ingrédient en premier mot', () => {
    expect(guessStock(withCategories('Gruyère râpé', ['en:cheeses', 'en:grated-cheeses']), CARNET)).toEqual({ link: { key: 'gruyere', name: 'gruyère', per: { quantity: 200, unit: 'g' } }, from: 'name' });
    expect(guessStock(withCategories('Lait demi-écrémé', ['en:milks'], '1 L'), CARNET)?.from).toBe('name');
  });

  it('« Chocolat au lait » : les catégories corrigent le nom (chocolat, pas lait)', () => {
    expect(guessStockLink(withCategories('Chocolat au lait', null), CARNET)?.key).toBe('lait');
    expect(guessStock(withCategories('Chocolat au lait', ['en:chocolates', 'en:milk-chocolates']), CARNET)).toMatchObject({ link: { key: 'chocolat' }, from: 'category' });
  });

  it('un nom sans indice (marque, nom de fantaisie) : proposé d’après les catégories', () => {
    expect(guessStock(withCategories('Fol Épi', ['en:dairies', 'en:cheeses']), CARNET)).toMatchObject({ link: { key: 'fromage', name: 'fromage' }, from: 'category' });
    expect(guessStock(withCategories('Mélange du chef', ['en:rices', 'en:basmati-rices'], '1 kg'), CARNET)).toEqual({ link: { key: 'riz-basmati', name: 'riz basmati', per: { quantity: 1, unit: 'kg' } }, from: 'category' });
  });

  it('un ingrédient plus loin dans le nom reste proposé si les catégories n’en disent rien ou le confirment', () => {
    expect(guessStock(withCategories('Filets de poulet', ['en:meats', 'en:poultries']), CARNET)).toMatchObject({ link: { key: 'poulet' }, from: 'name' });
    // Nom et catégories d'accord : « d'après le nom ».
    expect(guessStock(withCategories('Filets de poulet', ['en:chicken-breasts']), CARNET)).toMatchObject({ link: { key: 'poulet' }, from: 'name' });
    expect(guessStock(withCategories('Aiguillettes nature', ['en:chicken-breasts']), CARNET)).toMatchObject({ link: { key: 'poulet' }, from: 'category' });
  });

  it('le rayon choisi « ne se mange pas » l’emporte sur tout', () => {
    expect(guessStock({ ...withCategories('Lait corporel', ['en:milks']), category: 'Hygiène' }, CARNET)).toBeNull();
  });
});
