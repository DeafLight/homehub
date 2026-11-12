// Tests des catégories Open Food Facts ramenées à un ingrédient de recette (fiches inventées, aucun appel au service).
import { describe, expect, it } from 'vitest';
import { cleanCategories, guessFromCategories } from './food-categories.ts';

const known = (...names: [key: string, name: string][]) => names.map(([key, name]) => ({ key, name }));
const CARNET = known(['lait', 'lait'], ['fromage', 'fromage'], ['gruyere', 'gruyère'], ['chocolat', 'chocolat'], ['thon-au-naturel', 'thon au naturel'], ['lardon', 'lardon']);

describe('guessFromCategories', () => {
  it('la catégorie la plus précise d’abord, puis les plus larges', () => {
    expect(guessFromCategories(['en:dairies', 'en:cheeses', 'en:grated-cheeses'], CARNET)).toEqual({ ingredient: { key: 'gruyere', name: 'gruyère' }, known: true });
    expect(guessFromCategories(['en:dairies', 'en:cheeses', 'en:goat-cheeses'], CARNET)).toEqual({ ingredient: { key: 'fromage', name: 'fromage' }, known: true });
  });

  it('chocolat au lait : du chocolat, pas du lait', () => {
    expect(guessFromCategories(['en:sweet-snacks', 'en:chocolates', 'en:milk-chocolates'], CARNET)?.ingredient.key).toBe('chocolat');
    expect(guessFromCategories(['en:sweet-snacks', 'fr:chocolats-au-lait'], CARNET)?.ingredient.key).toBe('chocolat');
  });

  it('un ingrédient du carnet qui précise celui de la table (« thon au naturel » pour « thon »)', () => {
    expect(guessFromCategories(['en:seafood', 'en:tunas', 'en:canned-tunas'], CARNET)?.ingredient.key).toBe('thon-au-naturel');
  });

  it('catégorie française : un ingrédient du carnet dont tous les mots y sont, qui commence pareil', () => {
    expect(guessFromCategories(['en:meats', 'fr:lardons-fumes'], CARNET)?.ingredient.key).toBe('lardon');
    expect(guessFromCategories(['fr:Lardons-Fumés'], CARNET)?.ingredient.key).toBe('lardon');
  });

  it('rien de connu : l’ingrédient de la catégorie la plus précise de la table, marqué comme non connu', () => {
    expect(guessFromCategories(['en:cereals-and-potatoes', 'en:rices', 'en:basmati-rices'], CARNET)).toEqual({ ingredient: { key: 'riz-basmati', name: 'riz basmati' }, known: false });
  });

  it('sans catégorie, ou des catégories inconnues : rien', () => {
    expect(guessFromCategories(null, CARNET)).toBeNull();
    expect(guessFromCategories([], CARNET)).toBeNull();
    expect(guessFromCategories(['en:snacks', 'en:biscuits'], CARNET)).toBeNull();
  });
});

describe('cleanCategories', () => {
  it('garde les identifiants, en minuscules, sans doublons ni valeurs étranges', () => {
    expect(cleanCategories(['en:Milks', 'en:milks', ' fr:laits-demi-écrémés ', 'milks', 42, 'en:<script>'])).toEqual(['en:milks', 'fr:laits-demi-écrémés']);
    expect(cleanCategories(undefined)).toEqual([]);
    expect(cleanCategories('en:milks')).toEqual([]);
  });

  it('au plus 30', () => {
    expect(cleanCategories(Array.from({ length: 50 }, (_, i) => `en:c${i}`))).toHaveLength(30);
  });
});
