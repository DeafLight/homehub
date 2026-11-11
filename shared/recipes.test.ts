// Tests des règles du carnet : lignes analysées, durées dans les étapes, mode Cookeo, temps ISO et portions,
// relecture de la source.
import { describe, expect, it } from 'vitest';
import { cookeoMode, formatMinutes, ingredientLines, isoMinutes, mergeReread, type RecipeContent, refreshLine, scaleFactor, sourceLabel, stepDurations, yieldOf } from './recipes.ts';

const ids = () => {
  let n = 0;
  return () => `i${++n}`;
};

describe('ingredientLines', () => {
  it('garde la ligne d’origine, la clé et le rayon', () => {
    const [line] = ingredientLines('2 gros oignons émincés', null, ids());
    expect(line).toMatchObject({ id: 'i1', text: '2 gros oignons émincés', quantity: 2, unit: 'piece', name: 'oignon', key: 'oignon', aisle: 'Fruits et légumes', manual: false });
  });

  it('« sel, poivre » donne deux lignes qui gardent le même texte', () => {
    const lines = ingredientLines('Sel, poivre', 'Assaisonnement', ids());
    expect(lines.map((l) => [l.id, l.key, l.text, l.section])).toEqual([
      ['i1', 'sel', 'Sel, poivre', 'Assaisonnement'],
      ['i2', 'poivre', 'Sel, poivre', 'Assaisonnement'],
    ]);
  });
});

describe('refreshLine', () => {
  it('réanalyse une ligne modifiée', () => {
    const [line] = ingredientLines('2 oignons', null, ids());
    expect(refreshLine({ ...line, text: '3 échalotes' })).toMatchObject({ id: 'i1', quantity: 3, name: 'échalote', key: 'echalote' });
  });

  it('une correction à la main l’emporte', () => {
    const [line] = ingredientLines('1 boîte de tomates', null, ids());
    const fixed = { ...line, quantity: 400, unit: 'g' as const, name: 'tomates pelées', manual: true };
    expect(refreshLine(fixed)).toMatchObject({ quantity: 400, unit: 'g', name: 'tomates pelées', key: 'tomate-pelee', manual: true });
  });
});

describe('stepDurations', () => {
  it.each([
    ['Cuire en mode sous pression 35 minutes.', [2100]],
    ['Laisser reposer 1 h 30 au frais.', [5400]],
    ['Enfourner 1h30.', [5400]],
    ['Cuire 10 à 15 min, puis laisser tiédir 5 min.', [600, 300]],
    ['Laisser lever une demi-heure.', [1800]],
    ['Laisser mijoter une heure.', [3600]],
    ['Fouetter 30 secondes.', [30]],
    ['Préchauffer le four à 180 °C (th. 6).', []],
    ['Ajouter 200 g de farine et 2 sachets de levure.', []],
    ['Réserver 2 heures au réfrigérateur.', [7200]],
  ])('%s', (text, expected) => expect(stepDurations(text).map((d) => d.seconds)).toEqual(expected));

  it('donne le texte repéré, pour le bouton', () => {
    expect(stepDurations('Cuire 12 min à feu doux')[0]).toEqual({ seconds: 720, text: '12 min' });
  });
});

describe('cookeoMode', () => {
  it.each([
    ['Cuire en mode sous pression 35 minutes', 'Sous pression'],
    ['Lancer le mode dorer et faire revenir les oignons', 'Dorer'],
    ['Passer en mode mijoter 20 min', 'Mijoter'],
    ['Faire revenir les oignons dans une poêle', null],
  ])('%s → %s', (text, mode) => expect(cookeoMode(text)).toBe(mode));
});

describe('temps et portions', () => {
  it('isoMinutes', () => {
    expect(isoMinutes('PT10M')).toBe(10);
    expect(isoMinutes('PT1H30M')).toBe(90);
    expect(isoMinutes('P0DT0H35M')).toBe(35);
    expect(isoMinutes('PT105M')).toBe(105);
    expect(isoMinutes('PT0M')).toBeNull();
    expect(isoMinutes('20 minutes')).toBeNull();
    expect(isoMinutes(25)).toBe(25);
  });

  it('yieldOf', () => {
    expect(yieldOf('4')).toEqual({ servings: 4, unit: null });
    expect(yieldOf(4)).toEqual({ servings: 4, unit: null });
    expect(yieldOf(['1', 'portion'])).toEqual({ servings: 1, unit: null });
    expect(yieldOf('4 personnes')).toEqual({ servings: 4, unit: null });
    expect(yieldOf('4 à 6 personnes')).toEqual({ servings: 4, unit: null });
    expect(yieldOf('15 crêpes')).toEqual({ servings: 15, unit: 'crêpes' });
    expect(yieldOf(['6', '6 parts'])).toEqual({ servings: 6, unit: null });
    expect(yieldOf(undefined)).toEqual({ servings: null, unit: null });
  });

  it('formatMinutes et scaleFactor', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(75)).toBe('1 h 15');
    expect(formatMinutes(120)).toBe('2 h');
    expect(scaleFactor(4, 6)).toBe(1.5);
    expect(scaleFactor(null, 6)).toBe(1);
  });
});

describe('mergeReread', () => {
  const read = (over: Partial<RecipeContent> = {}): RecipeContent => ({
    title: 'Pot-au-feu', servings: 4, servingsUnit: null, ingredients: ingredientLines('4 carottes', null, ids()), steps: [],
    tips: '', prepMinutes: null, cookMinutes: null, totalMinutes: 50, appliance: 'cookeo', ...over,
  });
  const steps = [{ id: 's1', text: 'Lancer le mode dorer.', section: null }];

  it('les parties non touchées prennent la nouvelle lecture ; nos modifications et nos astuces restent', () => {
    const previous = read();
    const ours = { ...read(), title: 'Pot-au-feu de Sam', tips: 'Avec des navets.' };
    const fresh = read({ steps, totalMinutes: 55, title: 'Pot-au-feu express' });
    const result = mergeReread(ours, previous, fresh);
    expect(result.updated).toEqual(['étapes', 'temps']);
    expect(result.kept).toEqual(['titre']);
    expect(result.ours).toMatchObject({ title: 'Pot-au-feu de Sam', tips: 'Avec des navets.', steps, totalMinutes: 55 });
    expect(result.ours.ingredients).toEqual(ours.ingredients);
  });

  it('saisie à la main (pas de lecture précédente) : seules les parties vides sont remplies', () => {
    const ours = read({ title: 'Notre pot-au-feu', totalMinutes: null });
    const result = mergeReread(ours, null, read({ steps }));
    expect(result.updated).toEqual(['étapes', 'temps']);
    expect(result.kept).toEqual(['titre']);
    expect(result.ours.title).toBe('Notre pot-au-feu');
  });

  it('rien de nouveau : rien ne change', () => {
    const same = read({ steps });
    expect(mergeReread(same, same, read({ steps }))).toEqual({ ours: same, updated: [], kept: [] });
  });
});

describe('sourceLabel', () => {
  it('nomme la source selon son origine', () => {
    expect(sourceLabel({ site: 'Marmiton', url: 'https://www.marmiton.org/r' })).toBe('Marmiton');
    expect(sourceLabel({ site: 'Texte collé', url: null, origin: 'text' })).toBe('un texte collé');
    expect(sourceLabel({ site: 'Jow', url: 'https://jow.fr/r', origin: 'text' })).toBe('Jow, texte collé');
    expect(sourceLabel({ site: 'Le Petit Fourneau', url: 'https://petit-fourneau.example/r', origin: 'saved-page' })).toBe('Le Petit Fourneau, page enregistrée');
  });
});
