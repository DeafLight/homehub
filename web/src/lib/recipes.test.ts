// Tests de la logique du carnet côté front : recherche, lignes à l'échelle, étapes, édition, partage (lien, texte, page
// enregistrée), aperçu d'un import, relecture, signature des notes.
import { describe, expect, it } from 'vitest';
import { ingredientLines, type RecipeContent, type RecipeSummary } from '../../../shared/recipes.ts';
import {
  canEditRecipe,
  noteMeta,
  changeServings,
  contentProblem,
  rereadMessage,
  correctLine,
  durationText,
  editLineText,
  emptyContent,
  groupBySection,
  linesFromText,
  move,
  previewSummary,
  searchRecipes,
  servingsText,
  sharedLink,
  sharedRecipe,
  shownIngredients,
  shownSteps,
  timerLabel,
} from './recipes.ts';

const ingredientLinesFor = (text: string) => linesFromText(text);

const ids = () => {
  let n = 0;
  return () => `l${++n}`;
};

function content(lines: string[], extra: Partial<RecipeContent> = {}): RecipeContent {
  const next = ids();
  return { ...emptyContent('Galettes'), servings: 4, ingredients: lines.flatMap((l) => ingredientLines(l, null, next)), ...extra };
}

const summary = (title: string, extra: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id: title,
  title,
  photo: false,
  addedBy: { ownerId: 'alex', via: 'phone' },
  addedAt: '2026-11-01T10:00:00Z',
  servings: 4,
  servingsUnit: null,
  totalMinutes: null,
  appliance: null,
  site: null,
  ingredients: 3,
  ...extra,
});

describe('carnet', () => {
  it('cherche sans accents, dans le titre et le site ; filtre Cookeo', () => {
    const list = [summary('Crêpes sucrées', { site: 'Marmiton' }), summary('Mijoté de lentilles', { appliance: 'cookeo', site: 'Moulinex' }), summary('Tarte')];
    expect(searchRecipes(list, 'crepe').map((r) => r.title)).toEqual(['Crêpes sucrées']);
    expect(searchRecipes(list, 'moulinex').map((r) => r.title)).toEqual(['Mijoté de lentilles']);
    expect(searchRecipes(list, '', true).map((r) => r.title)).toEqual(['Mijoté de lentilles']);
    expect(searchRecipes(list, '')).toHaveLength(3);
  });

  it('servingsText', () => {
    expect(servingsText(4, null)).toBe('4 personnes');
    expect(servingsText(1, null)).toBe('1 personne');
    expect(servingsText(12, 'galettes')).toBe('12 galettes');
    expect(servingsText(null, null)).toBeNull();
  });
});

describe('fiche', () => {
  it('lignes telles qu’écrites à l’échelle 1, « sel, poivre » une seule fois', () => {
    const lines = shownIngredients(content(['300 g de farine', 'Sel, poivre']), 4);
    expect(lines[0].items.map((l) => l.text)).toEqual(['300 g de farine', 'Sel, poivre']);
  });

  it('lignes réécrites quand les portions changent', () => {
    const lines = shownIngredients(content(['300 g de farine', '1 oignon', 'Sel']), 8);
    expect(lines[0].items.map((l) => l.text)).toEqual(['600 g de farine', '2 oignons', 'Sel']);
  });

  it('groupes dans l’ordre', () => {
    const items = [{ section: 'Pâte' }, { section: 'Pâte' }, { section: null }, { section: 'Pâte' }];
    expect(groupBySection(items).map((g) => [g.section, g.items.length])).toEqual([['Pâte', 2], [null, 1], ['Pâte', 1]]);
  });

  it('étapes numérotées, durées, mode Cookeo seulement pour une recette Cookeo', () => {
    const steps = [{ id: 's1', text: 'Dorer en mode dorer 3 minutes.', section: null }];
    expect(shownSteps(content([], { steps, appliance: 'cookeo' }))[0]).toMatchObject({ number: 1, mode: 'Dorer', durations: [{ seconds: 180 }] });
    expect(shownSteps(content([], { steps }))[0].mode).toBeNull();
  });

  it('nom du minuteur : 30 caractères au plus, avec l’emoji de la cuisson', () => {
    expect(timerLabel('Galettes', 3)).toBe('Cuisson · ét. 3 · Galettes');
    const long = timerLabel('Mijoté de lentilles aux carottes', 12);
    expect(long.length).toBeLessThanOrEqual(30);
    expect(long.endsWith('…')).toBe(true);
    expect(durationText(30)).toBe('30 s');
    expect(durationText(5400)).toBe('1 h 30');
  });

  it('droit de modifier : un parent ou qui a ajouté la recette', () => {
    const recipe = { addedBy: { ownerId: 'lea', via: 'phone' as const } };
    expect(canEditRecipe({ id: 'lea', parent: false }, recipe)).toBe(true);
    expect(canEditRecipe({ id: 'tom', parent: false }, recipe)).toBe(false);
    expect(canEditRecipe({ id: 'alex', parent: true }, recipe)).toBe(true);
    expect(canEditRecipe(undefined, recipe)).toBe(false);
  });
});

describe('édition', () => {
  it('lignes tapées d’un coup, analysées', () => {
    expect(linesFromText('2 oignons\n\nsel, poivre').map((l) => l.key)).toEqual(['oignon', 'sel', 'poivre']);
  });

  it('texte modifié : réanalysé ; correction à la main : retenue et ligne réécrite', () => {
    const [line] = linesFromText('1 boîte de tomates');
    expect(editLineText(line, '3 tomates')).toMatchObject({ quantity: 3, unit: 'piece', key: 'tomate', manual: false });
    const fixed = correctLine(line, { quantity: 400, unit: 'g' });
    expect(fixed).toMatchObject({ quantity: 400, unit: 'g', manual: true, text: '400 g de tomates' });
    expect(editLineText(fixed, 'peu importe')).toMatchObject({ quantity: 400, manual: true });
    expect(correctLine(line, { name: 'tomates pelées' })).toMatchObject({ name: 'tomates pelées', text: '1 boîte de tomates pelées' });
  });

  it('portions par défaut : les quantités suivent, ou pas', () => {
    const base = content(['300 g de farine', '2 à 3 œufs', 'Sel']);
    const doubled = changeServings(base, 8);
    expect(doubled.servings).toBe(8);
    expect(doubled.ingredients.map((l) => l.text)).toEqual(['600 g de farine', '4 à 6 œufs', 'Sel']);
    expect(changeServings(base, 8, true).ingredients.map((l) => l.text)).toEqual(['300 g de farine', '2 à 3 œufs', 'Sel']);
  });

  it('déplacer, et ce qui manque pour enregistrer', () => {
    expect(move(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(contentProblem(emptyContent())).toBe('Donne un titre à la recette');
    expect(contentProblem(emptyContent('Tarte'))).toBe('Ajoute au moins un ingrédient ou une étape');
    expect(contentProblem(content(['1 pâte']))).toBeNull();
  });
});

describe('sharedLink', () => {
  it('lien du champ url, ou premier lien du texte', () => {
    expect(sharedLink(new URLSearchParams({ url: 'https://jow.fr/recipes/a', text: 'x' }))).toBe('https://jow.fr/recipes/a');
    expect(sharedLink(new URLSearchParams({ text: 'Regarde https://www.marmiton.org/recettes/b.aspx !' }))).toBe('https://www.marmiton.org/recettes/b.aspx');
    expect(sharedLink(new URLSearchParams({ text: 'Lait demi-écrémé' }))).toBeNull();
  });
});

describe('sharedRecipe', () => {
  const recipeText = 'Crêpes\nIngrédients\n250 g de farine\n4 œufs\n50 cl de lait\nPréparation\nMélanger.';

  it('page enregistrée déposée par le serveur, ou trop lourde', () => {
    expect(sharedRecipe(new URLSearchParams({ fichier: 'abc', title: 'Crêpes' }))).toEqual({ kind: 'file', id: 'abc', title: 'Crêpes' });
    expect(sharedRecipe(new URLSearchParams({ erreur: 'trop-lourd' }))).toEqual({ kind: 'too-large' });
  });

  it('texte copié qui ressemble à une recette, avec son lien s’il y en a un', () => {
    expect(sharedRecipe(new URLSearchParams({ text: `${recipeText}\nhttps://exemple.test/crepes` }))).toMatchObject({ kind: 'text', link: 'https://exemple.test/crepes' });
    expect(sharedRecipe(new URLSearchParams({ text: recipeText, title: 'Crêpes' }))).toEqual({ kind: 'text', text: recipeText, link: null, title: 'Crêpes' });
  });

  it('un lien seul, ou une note pour la liste', () => {
    expect(sharedRecipe(new URLSearchParams({ text: 'Regarde https://jow.fr/recipes/a' }))).toEqual({ kind: 'link', link: 'https://jow.fr/recipes/a' });
    expect(sharedRecipe(new URLSearchParams({ text: 'Lait demi-écrémé' }))).toBeNull();
  });
});

describe('previewSummary', () => {
  it('dit ce qui a été compris', () => {
    const content = { ...emptyContent('Crêpes'), ingredients: ingredientLinesFor('250 g de farine\n4 œufs'), steps: [{ id: 's', text: 'Mélanger.', section: null }] };
    expect(previewSummary({ token: 't', content, url: null, site: 'Texte collé', origin: 'text', photo: false })).toBe(
      'Compris dans le texte collé : 2 ingrédients, 1 étape, 4 personnes. Vérifie et corrige avant d’enregistrer.',
    );
    expect(previewSummary({ token: 't', content: { ...content, servings: null }, url: null, site: 'x', origin: 'saved-page', photo: true })).toBe(
      'Compris dans la page enregistrée : 2 ingrédients, 1 étape, photo. Vérifie et corrige avant d’enregistrer.',
    );
  });
});

describe('rereadMessage', () => {
  it('dit ce qui a été repris et ce que notre version a gardé', () => {
    expect(rereadMessage(['étapes'], [])).toBe('Repris de la page : étapes.');
    expect(rereadMessage(['ingrédients', 'étapes', 'temps'], ['titre'])).toBe('Repris de la page : ingrédients, étapes et temps. Notre version gardée pour : titre.');
    expect(rereadMessage([], [])).toBe('Rien de nouveau sur la page.');
  });
});

describe('signature des notes', () => {
  const now = new Date(2026, 10, 5, 19, 0);
  const names: Record<string, string> = { tom: 'Tom', alex: 'Alex' };
  const nameOf = (id: string) => names[id] ?? id;
  const base = { id: 'n', recipeId: 'r', text: 'Moins salé', by: { ownerId: 'tom', via: 'phone' as const }, at: new Date(2026, 10, 5, 18, 55).toISOString() };

  it('qui et quand, modifiée, résolue par qui', () => {
    expect(noteMeta(base, nameOf, now)).toBe('Tom · il y a 5 min');
    expect(noteMeta({ ...base, editedAt: now.toISOString() }, nameOf, now)).toBe('Tom · il y a 5 min · modifiée');
    const resolved = { ...base, resolvedAt: new Date(2026, 10, 4, 18, 30).toISOString(), resolvedBy: { ownerId: 'alex', via: 'tablet' as const } };
    expect(noteMeta(resolved, nameOf, now)).toBe('Tom · il y a 5 min — résolue par Alex hier à 18:30');
  });
});
