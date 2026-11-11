// Menu de la semaine côté serveur : la vue d'une semaine (recettes, courses calculées, stock à relier) et la
// synchronisation de la liste de courses. Les règles sont dans shared/menu.ts ; ici, on rassemble les magasins
// (menu, carnet, stock, listes). La synchronisation tourne après chaque changement qui la concerne (menu, placards,
// coches, liens, stock, recettes), et au premier passage d'une nouvelle semaine.
import {
  addWeeks,
  aggregateNeeds,
  boughtFor,
  type DesiredLine,
  desiredLines,
  labelKey,
  manualKeys,
  type MenuRecipe,
  type MenuStockProduct,
  type MenuView,
  planNeeds,
  type PlanLine,
  stockPool,
  type StockPool,
  syncOps,
  weekOf,
} from '../../shared/menu.ts';
import type { Recipe } from '../../shared/recipes.ts';
import { guessStockLink, type KnownIngredient } from '../../shared/stock-link.ts';
import type { Author, ShoppingItem, ShoppingMenuMark, StockData } from '../../shared/types.ts';
import type { ListsStore } from '../sources/lists.ts';
import type { MenuData, MenuStore } from '../sources/menus.ts';
import type { RecipeStore } from '../sources/recipes.ts';
import type { StockStore } from '../sources/stock.ts';
import type { Clock } from '../sources/types.ts';

export type MenuService = {
  view(week: string): Promise<MenuView>;
  /** Fait suivre la liste de courses ; renvoie le nombre de lignes changées. */
  sync(by: Author): Promise<number>;
  /** Synchronise si la semaine a changé depuis la dernière fois (ou au démarrage). */
  refreshIfNewWeek(): Promise<void>;
  /** Une ligne du menu retirée à la main : « j'en ai déjà » pour sa semaine, puis synchronisation. */
  lineRemoved(item: ShoppingItem, by: Author): Promise<void>;
};

const SYSTEM: Author = { ownerId: null, via: 'tablet' };

type Snapshot = { menu: MenuData; recipes: Recipe[]; stock: StockData; current: string };

/** Ingrédients connus du carnet (notre version de chaque recette), un par clé. */
function knownIngredients(recipes: readonly Recipe[]): KnownIngredient[] {
  const known = new Map<string, KnownIngredient>();
  for (const r of recipes) for (const line of r.ours.ingredients) if (line.key && !known.has(line.key)) known.set(line.key, { key: line.key, name: line.name });
  return [...known.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function createMenuService({ menus, recipes, stock, lists, clock }: { menus: MenuStore; recipes: RecipeStore; stock: StockStore; lists: ListsStore; clock: Clock }): MenuService {
  let syncedWeek: string | null = null;

  async function snapshot(): Promise<Snapshot> {
    const [menu, all, stockData] = await Promise.all([menus.data(), recipes.all(), stock.data()]);
    return { menu, recipes: all, stock: stockData, current: weekOf(clock()) };
  }

  const recipeLookup = (all: readonly Recipe[]) => {
    const byId = new Map(all.map((r) => [r.id, r]));
    return (id: string): MenuRecipe | null => byId.get(id)?.ours ?? null;
  };

  const poolOf = ({ menu, stock: data }: Snapshot): StockPool =>
    stockPool(data.items.map((i) => ({ name: i.product.current.name, count: i.quantity, link: menu.links[i.product.code] ?? null })));

  /** Semaines dont les courses comptent : la semaine en cours et celles à venir qui ont un menu, dans l'ordre. */
  const activeWeeks = ({ menu, current }: Snapshot) =>
    Object.keys(menu.weeks)
      .filter((w) => w >= current && menu.weeks[w].length > 0)
      .sort();

  /** Courses de chaque semaine active, le stock consommé de la plus proche à la plus lointaine. */
  function plans(snap: Snapshot, shopping: readonly ShoppingItem[], cleared: readonly ShoppingMenuMark[]): Map<string, PlanLine[]> {
    const pool = poolOf(snap);
    const recipeOf = recipeLookup(snap.recipes);
    const pantry = snap.menu.pantry.map(labelKey);
    const manual = manualKeys(shopping);
    const result = new Map<string, PlanLine[]>();
    for (const week of activeWeeks(snap)) {
      const needs = aggregateNeeds(snap.menu.weeks[week], recipeOf);
      result.set(week, planNeeds(needs, { pantry, have: new Set(snap.menu.have[week] ?? []), manual, bought: boughtFor(shopping, cleared, week), stock: pool }));
    }
    return result;
  }

  async function sync(by: Author): Promise<number> {
    const snap = await snapshot();
    syncedWeek = snap.current;
    return lists.syncMenu((shopping, cleared) => {
      const desired: DesiredLine[] = [];
      for (const [week, lines] of plans(snap, shopping, cleared)) desired.push(...desiredLines(lines, week));
      return syncOps(shopping, desired);
    }, by);
  }

  /** Produits du stock à relier : ceux qui ressemblent à un ingrédient, ou déjà décidés ; la semaine d'abord. */
  function stockProducts(snap: Snapshot, weekKeys: ReadonlySet<string>): MenuStockProduct[] {
    const known = knownIngredients(snap.recipes);
    const products: MenuStockProduct[] = [];
    for (const item of snap.stock.items) {
      const { code, current } = item.product;
      const decided = code in snap.menu.links;
      const link = decided ? snap.menu.links[code] : guessStockLink(current, known);
      if (!decided && (!link || item.quantity === 0)) continue;
      products.push({ code, name: current.name, quantity: current.quantity, count: item.quantity, link, decided });
    }
    const rank = (p: MenuStockProduct) => (!p.decided && p.link && weekKeys.has(p.link.key) ? 0 : !p.decided ? 1 : 2);
    return products.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'));
  }

  return {
    sync,

    async view(week) {
      const snap = await snapshot();
      const { shopping } = await lists.lists();
      const cleared = await lists.cleared();
      const entries = snap.menu.weeks[week] ?? [];
      const byId = new Map(snap.recipes.map((r) => [r.id, r]));
      let plan: PlanLine[];
      if (week >= snap.current) {
        plan = plans(snap, shopping, cleared).get(week) ?? [];
      } else {
        // Semaine passée : les ingrédients tels quels, sans ce qu'on avait (le stock a changé depuis).
        const needs = aggregateNeeds(entries, recipeLookup(snap.recipes));
        plan = planNeeds(needs, { pantry: snap.menu.pantry.map(labelKey), have: new Set(snap.menu.have[week] ?? []), manual: new Set(), bought: new Map(), stock: new Map() });
      }
      return {
        week,
        current: snap.current,
        editable: week >= snap.current,
        entries: entries.map((e) => {
          const recipe = byId.get(e.recipeId);
          return {
            ...e,
            title: recipe?.ours.title ?? e.title,
            servings: recipe?.ours.servings ?? null,
            servingsUnit: recipe?.ours.servingsUnit ?? null,
            photo: recipe?.photo ?? false,
            missing: !recipe,
          };
        }),
        plan,
        pantry: snap.menu.pantry,
        stock: stockProducts(snap, new Set(plan.map((l) => l.key))),
        ingredients: knownIngredients(snap.recipes),
      };
    },

    async refreshIfNewWeek() {
      if (syncedWeek !== weekOf(clock())) await sync(SYSTEM);
    },

    async lineRemoved(item, by) {
      if (!item.menu || item.done) return;
      await menus.setHave(item.menu.week, item.menu.key, true);
      await sync(by);
    },
  };
}

/** Semaines qu'on peut modifier : de la semaine en cours à quelques semaines devant. */
export function editableWeek(week: string, now: Date, ahead: number): 'past' | 'far' | 'ok' {
  const current = weekOf(now);
  if (week < current) return 'past';
  return week > addWeeks(current, ahead) ? 'far' : 'ok';
}
