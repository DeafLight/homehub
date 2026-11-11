// Tests de l'affichage du menu : semaines et jours, recettes par jour, rayons, ce qu'on a déjà en clair.
import { describe, expect, it } from 'vitest';
import type { MenuViewEntry, PlanLine } from '../../../shared/menu.ts';
import { byAisle, dayLabel, entriesByDay, itemAisle, lineAmount, lineSources, lineStatus, parsePantry, peopleLabel, planGroups, weekLabel, weekRange } from './menu.ts';

const W = '2026-11-09';
const entry = (id: string, day: string | null): MenuViewEntry => ({
  id,
  recipeId: 'r',
  title: 'Mijoté',
  people: 4,
  day,
  addedBy: { ownerId: 'alex', via: 'phone' },
  addedAt: '',
  servings: 4,
  servingsUnit: null,
  photo: false,
  missing: false,
});
const line = (over: Partial<PlanLine>): PlanLine => ({
  key: 'lait',
  name: 'Lait',
  aisle: 'Crèmerie',
  quantities: { volume: 600 },
  toTaste: false,
  optional: false,
  sources: [{ recipeId: 'a', title: 'Mijoté', count: 2 }, { recipeId: 'b', title: 'Galettes', count: 1 }],
  status: 'buy',
  buy: { volume: 600 },
  buyToTaste: false,
  stock: null,
  bought: null,
  check: null,
  packs: null,
  ...over,
});

describe('semaines et jours', () => {
  it('en toutes lettres', () => {
    expect(weekLabel(W, W)).toBe('Cette semaine');
    expect(weekLabel('2026-11-16', W)).toBe('Semaine prochaine');
    expect(weekLabel('2026-11-02', W)).toBe('Semaine dernière');
    expect(weekLabel('2026-11-23', W)).toBe('Semaine du 23 nov.');
    expect(weekRange(W)).toBe('du 9 au 15 nov.');
    expect(weekRange('2026-10-26')).toBe('du 26 oct. au 1 nov.');
    expect(dayLabel('2026-11-11')).toBe('Mercredi 11');
    expect(peopleLabel({ people: 4, servingsUnit: null })).toBe('4 pers.');
    expect(peopleLabel({ people: 12, servingsUnit: 'galettes' })).toBe('12 galettes');
  });

  it('recettes rangées par jour, puis sans jour', () => {
    const groups = entriesByDay(W, [entry('a', '2026-11-11'), entry('b', null), entry('c', '2026-11-11')]);
    expect(groups).toHaveLength(8);
    expect(groups[2].entries.map((e) => e.id)).toEqual(['a', 'c']);
    expect(groups[7]).toMatchObject({ day: null, label: 'Dans la semaine, sans jour' });
    expect(entriesByDay(W, [entry('b', null)], false).map((g) => g.day)).toEqual([null]);
  });
});

describe('rayons', () => {
  it('dans l’ordre du magasin, « Autres » à la fin', () => {
    const groups = byAisle(['lessive', 'lait', 'oignon', 'beurre'], (x) => ({ lait: 'Crèmerie', oignon: 'Fruits et légumes', beurre: 'Crèmerie' })[x] ?? null);
    expect(groups).toEqual([
      { aisle: 'Fruits et légumes', items: ['oignon'] },
      { aisle: 'Crèmerie', items: ['lait', 'beurre'] },
      { aisle: 'Autres', items: ['lessive'] },
    ]);
  });

  it('rayon d’un article : celui du menu, sinon deviné', () => {
    expect(itemAisle({ label: 'Yaourts nature' })).toBe('Crèmerie');
    expect(itemAisle({ label: 'Lessive' })).toBeNull();
    expect(itemAisle({ label: 'Lait · 50 cl', menu: { week: W, key: 'lait', quantities: {}, toTaste: false, aisle: 'Épicerie', sources: [] } })).toBe('Épicerie');
  });
});

describe('courses du menu', () => {
  it('à acheter par rayon, le reste à part', () => {
    const { toBuy, covered } = planGroups([line({}), line({ key: 'sel', status: 'pantry', aisle: 'Épices et condiments' })]);
    expect(toBuy.map((g) => g.aisle)).toEqual(['Crèmerie']);
    expect(covered.map((l) => l.key)).toEqual(['sel']);
  });

  it('quantités et ce qu’on a déjà, en clair', () => {
    expect(lineAmount(line({}))).toBe('60 cl');
    expect(lineSources(line({}))).toBe('Mijoté ×2, Galettes');
    expect(lineStatus(line({}))).toBeNull();
    expect(lineStatus(line({ status: 'stock', stock: { quantities: { volume: 600 }, products: ['2 × Lait demi-écrémé'], enough: true, opened: [] } }))).toBe('En stock (2 × Lait demi-écrémé)');
    expect(lineStatus(line({ buy: { volume: 100 }, stock: { quantities: { volume: 500 }, products: ['Lait'], enough: false, opened: [] } }))).toBe('En stock : 50 cl (Lait)');
    expect(lineStatus(line({ stock: { quantities: {}, products: ['Lait'], enough: null, opened: [] } }))).toBe('En stock, à vérifier (Lait)');
    expect(lineStatus(line({ stock: { quantities: {}, products: ['Lait'], enough: false, opened: [] } }))).toBe('En stock, pas assez (Lait)');
    expect(lineStatus(line({ status: 'have', buy: {} }))).toBe('J’en ai déjà');
    expect(lineAmount(line({ status: 'have', buy: {} }))).toBe('60 cl');
  });

  it('paquet peut-être entamé et arrondi au paquet', () => {
    const opened = { quantities: {}, products: ['Gruyère râpé'], enough: false, opened: ['Gruyère râpé'] };
    const ask = line({ key: 'gruyere', buy: { masse: 160 }, stock: opened, check: 'ask', packs: { count: 1, per: { quantity: 200, unit: 'g' } } });
    expect(lineStatus(ask)).toBe('Paquet peut-être entamé (Gruyère râpé)');
    expect(lineAmount(ask)).toBe('160 g (1 × 200 g)');
    expect(lineStatus(line({ stock: opened, check: 'needed' }))).toBe('Vérifié : il en faut');
    expect(lineStatus(line({ status: 'stock', stock: { ...opened, enough: true }, check: 'enough' }))).toBe('Assez au placard (Gruyère râpé)');
    const groups = planGroups([ask, line({ key: 'lait' }), line({ key: 'oeuf', status: 'have' }), line({ key: 'beurre', check: 'needed' })]);
    expect(groups.toCheck.map((l) => l.key)).toEqual(['gruyere']);
    expect(groups.toBuy.flatMap((g) => g.items.map((l) => l.key))).toEqual(['lait', 'beurre']);
    expect(groups.covered.map((l) => l.key)).toEqual(['oeuf']);
  });

  it('placards saisis en une ligne', () => {

    expect(parsePantry('sel, Poivre ; huile\nsel,  ')).toEqual(['sel', 'Poivre', 'huile']);
  });
});
