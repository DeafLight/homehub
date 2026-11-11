// Tests du menu de la semaine : semaines, agrégation des recettes à l'échelle, ce qu'on a déjà (placards, coche,
// ligne à la main, déjà acheté, stock) et la synchronisation avec la liste de courses, cas limites compris.
import { describe, expect, it } from 'vitest';
import {
  addWeeks,
  aggregateNeeds,
  boughtFor,
  desiredLines,
  type HaveState,
  inPantry,
  isWeek,
  manualKeys,
  type MenuEntry,
  type MenuRecipe,
  planNeeds,
  stockPool,
  syncOps,
  weekDays,
  weekOf,
} from './menu.ts';
import { ingredientLines } from './recipes.ts';
import type { ShoppingMenuMark } from './types.ts';

const ids = () => {
  let n = 0;
  return () => `l${++n}`;
};
const recipe = (title: string, servings: number | null, lines: string[]): MenuRecipe => {
  const next = ids();
  return { title, servings, servingsUnit: null, ingredients: lines.flatMap((t) => ingredientLines(t, null, next)) };
};
const RECIPES: Record<string, MenuRecipe> = {
  mijote: recipe('Mijoté', 4, ['300 g de lentilles', '3 carottes', '1 oignon', '1 c. à s. d’huile d’olive', 'Sel, poivre']),
  pates: recipe('Pâtes au thon', 4, ['400 g de pâtes', '100 g d’oignons', '20 cl de lait', 'Persil']),
  galettes: recipe('Galettes', 12, ['250 g de farine de sarrasin', '2 à 3 œufs', '50 cl de lait']),
};
const recipeOf = (id: string) => RECIPES[id] ?? null;
let n = 0;
const entry = (recipeId: string, people: number, day: string | null = null): MenuEntry => ({
  id: `e${++n}`,
  recipeId,
  title: RECIPES[recipeId]?.title ?? 'Recette retirée',
  people,
  day,
  addedBy: { ownerId: 'alex', via: 'phone' },
  addedAt: '2026-11-09T08:00:00.000Z',
});
const state = (over: Partial<HaveState> = {}): HaveState => ({
  pantry: [],
  have: new Set(),
  manual: new Set(),
  bought: new Map(),
  stock: new Map(),
  ...over,
});
const W = '2026-11-09';

describe('semaines', () => {
  it('commencent le lundi', () => {
    expect(weekOf(new Date(2026, 10, 11))).toBe(W);
    expect(weekOf(new Date(2026, 10, 15))).toBe(W); // dimanche
    expect(weekOf(new Date(2026, 10, 9))).toBe(W);
    expect(addWeeks(W, -1)).toBe('2026-11-02');
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04');
    expect(weekDays(W)).toHaveLength(7);
    expect(weekDays(W)[6]).toBe('2026-11-15');
    expect(isWeek(W)).toBe(true);
    expect(isWeek('2026-11-10')).toBe(false);
  });
});

describe('inPantry', () => {
  it('couvre la clé et ses variantes', () => {
    const pantry = ['sel', 'huile', 'poivre'];
    expect(inPantry('huile-d-olive', pantry)).toBe(true);
    expect(inPantry('gros-sel', pantry)).toBe(true);
    expect(inPantry('poivre', pantry)).toBe(true);
    expect(inPantry('poivron', pantry)).toBe(false);
    expect(inPantry('selle-d-agneau', pantry)).toBe(false);
    expect(inPantry('beurre-demi-sel', pantry)).toBe(false);
    expect(inPantry('poivre-du-moulin', pantry)).toBe(true);
  });
});

describe('aggregateNeeds', () => {
  it('met à l’échelle des personnes et regroupe entre recettes', () => {
    const needs = aggregateNeeds([entry('mijote', 2), entry('pates', 4)], recipeOf);
    const oignon = needs.find((x) => x.key === 'oignon')!;
    expect(oignon.quantities).toEqual({ piece: 0.5, masse: 100 });
    expect(oignon.sources.map((s) => s.title)).toEqual(['Mijoté', 'Pâtes au thon']);
    expect(needs.find((x) => x.key === 'lentille')!.quantities).toEqual({ masse: 150 });
    expect(needs.find((x) => x.key === 'persil')!.toTaste).toBe(true);
    expect(oignon.aisle).toBe('Fruits et légumes');
  });

  it('additionne une recette qui revient, et compte ses passages', () => {
    const needs = aggregateNeeds([entry('mijote', 4), entry('mijote', 2)], recipeOf);
    const carotte = needs.find((x) => x.key === 'carotte')!;
    expect(carotte.quantities).toEqual({ piece: 4.5 });
    expect(carotte.sources).toEqual([{ recipeId: 'mijote', title: 'Mijoté', count: 2 }]);
  });

  it('convertit les volumes et prend la borne haute d’une plage', () => {
    const needs = aggregateNeeds([entry('pates', 4), entry('galettes', 24)], recipeOf);
    expect(needs.find((x) => x.key === 'lait')!.quantities).toEqual({ volume: 1200 });
    expect(needs.find((x) => x.key === 'oeuf')!.quantities).toEqual({ piece: 6 });
  });

  it('ignore une recette qui n’est plus au carnet', () => {
    expect(aggregateNeeds([entry('disparue', 4)], recipeOf)).toEqual([]);
  });
});

describe('planNeeds', () => {
  const needs = () => aggregateNeeds([entry('mijote', 4), entry('pates', 4)], recipeOf);
  const byKey = (lines: ReturnType<typeof planNeeds>) => Object.fromEntries(lines.map((l) => [l.key, l]));

  it('retire les placards, la coche et les lignes à la main', () => {
    const plan = byKey(planNeeds(needs(), state({ pantry: ['sel', 'poivre', 'huile'], have: new Set(['lait']), manual: new Set(['carotte']) })));
    expect(plan['huile-d-olive'].status).toBe('pantry');
    expect(plan.sel.status).toBe('pantry');
    expect(plan.lait.status).toBe('have');
    expect(plan.carotte.status).toBe('manual');
    expect(plan.lentille).toMatchObject({ status: 'buy', buy: { masse: 300 } });
    expect(plan.persil).toMatchObject({ status: 'buy', buy: {}, buyToTaste: true });
  });

  it('ne rachète que la différence de ce qui est déjà acheté', () => {
    const bought = new Map([['lentille', { quantities: { masse: 200 }, toTaste: false }], ['persil', { quantities: {}, toTaste: true }]]);
    const plan = byKey(planNeeds(needs(), state({ bought })));
    expect(plan.lentille).toMatchObject({ status: 'buy', buy: { masse: 100 } });
    expect(plan.persil.status).toBe('bought');
  });

  it('retire ce qui est en stock en quantité suffisante, donne la différence sinon', () => {
    const stock = stockPool([
      { name: 'Lait demi-écrémé', count: 3, link: { key: 'lait', name: 'lait', per: { quantity: 1, unit: 'l' } } },
      { name: 'Coquillettes', count: 1, link: { key: 'pate', name: 'pâtes', per: { quantity: 250, unit: 'g' } } },
    ]);
    const plan = byKey(planNeeds(needs(), state({ stock })));
    expect(plan.lait).toMatchObject({ status: 'stock', stock: { enough: true, products: ['3 × Lait demi-écrémé'] } });
    expect(plan.pate).toMatchObject({ status: 'buy', buy: { masse: 150 }, stock: { enough: false, quantities: { masse: 250 } } });
  });

  it('signale sans trancher un stock qui ne se compare pas', () => {
    const stock = stockPool([
      { name: 'Lentilles vertes', count: 1, link: { key: 'lentille', name: 'lentille', per: null } },
      { name: 'Oignons filet', count: 1, link: { key: 'oignon', name: 'oignon', per: { quantity: 1, unit: 'kg' } } },
    ]);
    const plan = byKey(planNeeds(needs(), state({ stock })));
    expect(plan.lentille).toMatchObject({ status: 'buy', buy: { masse: 300 }, stock: { enough: null } });
    // 1 oignon (pièce) contre 1 kg : les 100 g sont couverts, la pièce reste due, à vérifier.
    expect(plan.oignon).toMatchObject({ status: 'buy', buy: { piece: 1 }, stock: { enough: null } });
  });

  it('consomme le stock d’une semaine à l’autre', () => {
    const stock = stockPool([{ name: 'Lait', count: 1, link: { key: 'lait', name: 'lait', per: { quantity: 1, unit: 'l' } } }]);
    const shared = state({ stock });
    const first = byKey(planNeeds(aggregateNeeds([entry('galettes', 24)], recipeOf), shared));
    const second = byKey(planNeeds(aggregateNeeds([entry('galettes', 12)], recipeOf), shared));
    expect(first.lait.status).toBe('stock');
    expect(second.lait).toMatchObject({ status: 'buy', buy: { volume: 500 } });
  });
});

describe('liste de courses', () => {
  const mark = (key: string, quantities: ShoppingMenuMark['quantities'], week = W): ShoppingMenuMark => ({ week, key, quantities, toTaste: false, aisle: null, sources: ['Mijoté'] });
  const plan = () => planNeeds(aggregateNeeds([entry('mijote', 4)], recipeOf), state({ pantry: ['sel', 'poivre', 'huile'] }));

  it('libellés avec quantités et recettes', () => {
    const lines = desiredLines(plan(), W);
    expect(lines.map((l) => l.label)).toEqual(['Lentille · 300 g', 'Carotte · 3', 'Oignon · 1']);
    expect(lines[0].menu).toMatchObject({ week: W, key: 'lentille', sources: ['Mijoté'], aisle: 'Épicerie' });
  });

  it('clés des lignes à la main et déjà acheté de la semaine', () => {
    const items = [
      { id: 'a', label: 'Tomates', done: false },
      { id: 'b', label: 'Lessive', done: true },
      { id: 'c', label: 'Lentille · 200 g', done: true, menu: mark('lentille', { masse: 200 }) },
      { id: 'd', label: 'Lentille · 100 g', done: true, menu: mark('lentille', { masse: 100 }, '2026-11-02') },
    ];
    expect(manualKeys(items)).toEqual(new Set(['tomate']));
    const bought = boughtFor(items, [mark('lentille', { masse: 50 })], W);
    expect(bought.get('lentille')).toEqual({ quantities: { masse: 250 }, toTaste: false });
  });

  describe('syncOps', () => {
    const desired = () => desiredLines(plan(), W);

    it('ajoute ce qui manque', () => {
      const ops = syncOps([{ id: 'x', label: 'Lessive', done: false }], desired());
      expect(ops.add.map((l) => l.label)).toEqual(['Lentille · 300 g', 'Carotte · 3', 'Oignon · 1']);
      expect(ops.update).toEqual([]);
      expect(ops.remove).toEqual([]);
    });

    it('met à jour une ligne du menu non cochée, sans toucher aux autres', () => {
      const [lentille, carotte] = desired();
      const items = [
        { id: 'a', label: 'Lentille · 150 g', done: false, menu: { ...lentille.menu, quantities: { masse: 150 } } },
        { id: 'b', ...carotte, done: false },
        { id: 'c', label: 'Oignon · 1', done: true, menu: mark('oignon', { piece: 1 }) },
        { id: 'd', label: 'Lessive', done: false },
      ];
      const ops = syncOps(items, desired().slice(0, 2));
      expect(ops.update).toEqual([{ id: 'a', ...lentille }]);
      expect(ops.add).toEqual([]);
      expect(ops.remove).toEqual([]);
    });

    it('retire une ligne du menu qui n’a plus lieu d’être (recette retirée, semaine passée)', () => {
      const items = [
        { id: 'a', label: 'Lentille · 300 g', done: false, menu: mark('lentille', { masse: 300 }) },
        { id: 'b', label: 'Farine · 250 g', done: false, menu: mark('farine', { masse: 250 }, '2026-11-02') },
        { id: 'c', label: 'Farine · 250 g', done: true, menu: mark('farine', { masse: 250 }, '2026-11-02') },
      ];
      expect(syncOps(items, []).remove).toEqual(['a', 'b']);
    });

    it('ne garde qu’une ligne ouverte par ingrédient et par semaine', () => {
      const [lentille] = desired();
      const items = [
        { id: 'a', ...lentille, done: false },
        { id: 'b', label: 'Lentille · 100 g', done: false, menu: mark('lentille', { masse: 100 }) },
      ];
      const ops = syncOps(items, [lentille]);
      expect(ops.remove).toEqual(['b']);
      expect(ops.update).toEqual([]);
    });

    it('une semaine différente fait une autre ligne', () => {
      const [lentille] = desired();
      const ops = syncOps([{ id: 'a', ...lentille, done: false }], [lentille, { ...lentille, menu: { ...lentille.menu, week: addWeeks(W, 1) } }]);
      expect(ops.add).toHaveLength(1);
      expect(ops.add[0].menu.week).toBe('2026-11-16');
    });

    it('cas complet : personnes en plus après achat, seule la différence revient', () => {
      const items = [{ id: 'a', label: 'Lentille · 300 g', done: true, menu: mark('lentille', { masse: 300 }) }];
      const needs = aggregateNeeds([entry('mijote', 6)], recipeOf);
      const lines = planNeeds(needs, state({ pantry: ['sel', 'poivre', 'huile'], bought: boughtFor(items, [], W) }));
      const ops = syncOps(items, desiredLines(lines, W));
      expect(ops.add.find((l) => l.menu.key === 'lentille')?.label).toBe('Lentille · 150 g');
      expect(ops.remove).toEqual([]);
    });
  });
});
