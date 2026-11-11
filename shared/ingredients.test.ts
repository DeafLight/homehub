// Tests de l'analyseur d'ingrédients : quantités (fractions, plages, nombres en lettres), unités (abréviations,
// collées au nombre), nom et précisions, lignes sans quantité, mise à l'échelle et réécriture, clé et rayon.
import { describe, expect, it } from 'vitest';
import { formatIngredient, formatQuantity, guessAisle, ingredientKey, parseIngredient, parseIngredientLine, plural, singular } from './ingredients.ts';

const pick = (line: string) => {
  const p = parseIngredient(line);
  return { q: p.quantity, max: p.quantityMax, unit: p.unit, name: p.name, notes: p.notes };
};

describe('parseIngredient : quantités', () => {
  it.each([
    ['2 gros oignons émincés', { q: 2, max: null, unit: 'piece', name: 'oignon', notes: 'gros, émincés' }],
    ['1/2 citron', { q: 0.5, max: null, unit: 'piece', name: 'citron', notes: '' }],
    ['½ citron', { q: 0.5, max: null, unit: 'piece', name: 'citron', notes: '' }],
    ['1 1/2 l de lait', { q: 1.5, max: null, unit: 'l', name: 'lait', notes: '' }],
    ['1½ l de lait', { q: 1.5, max: null, unit: 'l', name: 'lait', notes: '' }],
    ['1,5 kg de pommes de terre', { q: 1.5, max: null, unit: 'kg', name: 'pomme de terre', notes: '' }],
    ['1.5 kg de pommes de terre', { q: 1.5, max: null, unit: 'kg', name: 'pomme de terre', notes: '' }],
    ['2 à 3 tomates', { q: 2, max: 3, unit: 'piece', name: 'tomate', notes: '' }],
    ['2-3 gousses d’ail', { q: 2, max: 3, unit: 'gousse', name: 'ail', notes: '' }],
    ['deux œufs', { q: 2, max: null, unit: 'piece', name: 'œuf', notes: '' }],
    ['une pincée de sel', { q: 1, max: null, unit: 'pincee', name: 'sel', notes: '' }],
    ['Une demi-baguette', { q: 0.5, max: null, unit: 'piece', name: 'baguette', notes: '' }],
    ['environ 200 g de riz', { q: 200, max: null, unit: 'g', name: 'riz', notes: 'environ' }],
  ])('%s', (line, expected) => expect(pick(line)).toEqual(expected));
});

describe('parseIngredient : unités', () => {
  it.each([
    ['300 g de farine', 'g', 'farine'],
    ['250g Champignons de Paris', 'g', 'champignon de Paris'],
    ['20 cl de crème liquide', 'cl', 'crème liquide'],
    ['20cl de crème', 'cl', 'crème'],
    ['1 l d’eau', 'l', 'eau'],
    ['3 cuillères à soupe de sucre', 'cs', 'sucre'],
    ['2 c. à s. d’huile d’olive', 'cs', 'huile d’olive'],
    ['2 c.à.s. de miel', 'cs', 'miel'],
    ['2 càs Lait de coco', 'cs', 'lait de coco'],
    ['1 cuil. à soupe de moutarde', 'cs', 'moutarde'],
    ['1/4 càc Curry (poudre)', 'cc', 'curry'],
    ['1 c. à café de cannelle', 'cc', 'cannelle'],
    ['1 cc de cumin', 'cc', 'cumin'],
    ['1 kg de bœuf', 'kg', 'bœuf'],
    ['500 grammes de pâtes', 'g', 'pâte'],
    ['1 sachet de levure chimique', 'sachet', 'levure chimique'],
    ['1 boîte de tomates pelées', 'boite', 'tomate'],
    ['1 noix de beurre', 'noix', 'beurre'],
    ['1 filet d’huile d’olive', 'filet', 'huile d’olive'],
    ['1 cube de bouillon de volaille', 'cube', 'bouillon de volaille'],
    ['1 rouleau de pâte feuilletée', 'rouleau', 'pâte feuilletée'],
  ])('%s → %s, %s', (line, unit, name) => {
    const p = parseIngredient(line);
    expect([p.unit, p.name]).toEqual([unit, name]);
  });

  it('un mot d’unité sans rien derrière est l’ingrédient (« 10 noix »)', () => {
    expect(pick('10 noix')).toMatchObject({ q: 10, unit: 'piece', name: 'noix' });
  });

  it('un filet de viande n’est pas une mesure', () => {
    expect(pick('4 filets de poulet')).toMatchObject({ q: 4, unit: 'piece', name: 'filet de poulet' });
  });

  it('« gros » ne se prend pas pour des grammes', () => {
    expect(pick('3 grosses carottes')).toMatchObject({ unit: 'piece', name: 'carotte', notes: 'grosses' });
  });
});

describe('parseIngredient : nom et précisions', () => {
  it('parenthèses et virgule passent en précisions', () => {
    expect(pick('1   Poulet (escalope)')).toMatchObject({ q: 1, name: 'poulet', notes: 'escalope' });
    expect(pick('1 oignon, finement haché')).toMatchObject({ name: 'oignon', notes: 'finement haché' });
  });

  it('découpe en fin de nom', () => {
    expect(pick('4 carottes coupées en rondelles')).toMatchObject({ name: 'carotte', notes: 'coupées en rondelles' });
    expect(pick('200 g de lardons en dés')).toMatchObject({ name: 'lardon', notes: 'en dés' });
    expect(pick('3 oeufs entiers')).toMatchObject({ name: 'oeuf', notes: 'entiers' });
  });

  it('garde les groupes figés', () => {
    expect(pick('200 g de petits pois')).toMatchObject({ name: 'petit pois', notes: '' });
    expect(pick('1 pincée de gros sel')).toMatchObject({ name: 'gros sel' });
  });

  it('facultatif, en tête ou entre parenthèses', () => {
    expect(parseIngredient('facultatif 1 càc Piment').optional).toBe(true);
    expect(parseIngredient('1 càc de piment (facultatif)').optional).toBe(true);
    expect(parseIngredient('1 càc de piment, facultatif').optional).toBe(true);
    expect(parseIngredient('1 càc de piment').optional).toBe(false);
  });

  it('garde la ligne écrite comme libellé', () => {
    expect(parseIngredient('2 gros oignons émincés').label).toBe('gros oignons émincés');
    expect(parseIngredient('300 g de farine').label).toBe('farine');
  });
});

describe('parseIngredient : sans quantité', () => {
  it.each([
    ['Sel', 'sel', ''],
    ['poivre du moulin', 'poivre du moulin', ''],
    ['quelques brins de persil', 'brin de persil', 'quelques'],
    ['un peu de beurre pour le moule', 'beurre', 'un peu, pour le moule'],
    ['Huile d’olive', 'huile d’olive', ''],
  ])('%s', (line, name, notes) => {
    expect(pick(line)).toEqual({ q: null, max: null, unit: null, name, notes });
  });
});

describe('parseIngredientLine', () => {
  it('sépare « sel, poivre » et « sel et poivre »', () => {
    expect(parseIngredientLine('Sel, poivre').map((p) => p.name)).toEqual(['sel', 'poivre']);
    expect(parseIngredientLine('sel et poivre du moulin').map((p) => p.name)).toEqual(['sel', 'poivre du moulin']);
  });

  it('ne coupe jamais une ligne avec quantité, ni un nom long', () => {
    expect(parseIngredientLine('2 oignons, émincés')).toHaveLength(1);
    expect(parseIngredientLine('pâte brisée prête à dérouler, beurre')).toHaveLength(1);
  });
});

describe('formatQuantity', () => {
  it.each([
    [250, 'g', '250'],
    [333.3, 'g', '335'],
    [12.4, 'g', '12'],
    [2.5, 'g', '2,5'],
    [1.25, 'kg', '1,25'],
    [0.5, 'piece', '½'],
    [1.5, 'piece', '1 ½'],
    [0.33, 'cs', '⅓'],
    [2.9, 'piece', '3'],
    [0.05, 'cc', '¼'],
    [3, null, '3'],
  ] as const)('%s %s → %s', (q, unit, expected) => expect(formatQuantity(q, unit)).toBe(expected));
});

describe('formatIngredient : mise à l’échelle', () => {
  const at = (line: string, factor: number) => formatIngredient(parseIngredient(line), factor);

  it('réécrit avec « de » ou « d’ »', () => {
    expect(at('300 g de farine', 2)).toBe('600 g de farine');
    expect(at('2 c. à s. d’huile d’olive', 1.5)).toBe("3 c. à s. d'huile d’olive");
    expect(at('1 pincée de sel', 2)).toBe('2 pincées de sel');
  });

  it('accorde le premier mot quand on passe au-dessus ou au-dessous de 1', () => {
    expect(at('1 oignon', 2)).toBe('2 oignons');
    expect(at('1 poireau', 3)).toBe('3 poireaux');
    expect(at('2 oignons', 0.5)).toBe('1 oignon');
    expect(at('2 gros oignons émincés', 2)).toBe('4 gros oignons émincés');
  });

  it('plages et lignes sans quantité', () => {
    expect(at('2 à 3 tomates', 2)).toBe('4 à 6 tomates');
    expect(at('Sel', 4)).toBe('Sel');
  });
});

describe('clés, singulier, rayons', () => {
  it('clé normalisée', () => {
    expect(ingredientKey('Oignons')).toBe('oignon');
    expect(ingredientKey('pommes de terre')).toBe('pomme-de-terre');
    expect(ingredientKey('Œufs')).toBe('oeuf');
    expect(ingredientKey('huile d’olive')).toBe('huile-d-olive');
  });

  it('singulier et pluriel', () => {
    expect(singular('poireaux')).toBe('poireau');
    expect(singular('choux')).toBe('chou');
    expect(singular('radis')).toBe('radis');
    expect(singular('tomates cerises')).toBe('tomate cerise');
    expect(plural('chou')).toBe('choux');
    expect(plural('noix')).toBe('noix');
  });

  it('rayon probable', () => {
    expect(guessAisle('oignon')).toBe('Fruits et légumes');
    expect(guessAisle('lait-de-coco')).toBe('Épicerie');
    expect(guessAisle('lait')).toBe('Crèmerie');
    expect(guessAisle('blanc-de-poulet')).toBe('Boucherie');
    expect(guessAisle('farine')).toBe('Épicerie');
    expect(guessAisle('noix-de-muscade')).toBe('Épices et condiments');
    expect(guessAisle('licorne')).toBeNull();
  });
});
