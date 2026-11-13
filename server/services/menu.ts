// Menu de la semaine côté serveur : la vue d'une semaine (recettes, courses calculées, stock à relier) et la
// synchronisation de la liste de courses. Les règles sont dans shared/menu.ts ; ici, on rassemble les magasins
// (menu, carnet, stock, listes). La synchronisation tourne après chaque changement qui la concerne (menu, placards,
// coches, liens, stock, recettes), et au premier passage d'un nouveau jour (les frais d'un repas tardif rejoignent la
// liste le jour où les acheter ; une nouvelle semaine remplace les lignes de la précédente). « S'utilise en plusieurs fois » est
// la valeur du lien, ou devinée d'après les recettes du carnet quand le lien ne la donne pas. Un repas noté cuisiné sort
// du calcul pour ses ingrédients qui ont eu une réponse (voir shared/menu.ts) ; le paquet entamé dont on sait ce qui
// reste compte pour cette part. Le panneau « J'ai cuisiné » prend ici les produits reliés et les contenants (cookContext).
import {
  addWeeks,
  aggregateNeeds,
  boughtFor,
  cookedParts,
  type DesiredLine,
  desiredLines,
  labelKey,
  largestNeeds,
  laterLines,
  manualKeys,
  type MenuRecipe,
  type MenuStockProduct,
  type MenuView,
  packSizes,
  planNeeds,
  type PlanLine,
  type StockLink,
  stockPool,
  type StockPool,
  syncOps,
  weekOf,
  withoutCooked,
} from '../../shared/menu.ts';
import { type CookContainer, type CookContext, type CookProduct, cookWindow } from '../../shared/cook.ts';
import { isLooseCode } from '../../shared/barcode.ts';
import type { Recipe } from '../../shared/recipes.ts';
import type { Quantities } from '../../shared/quantities.ts';
import { guessPartial, guessStock, type KnownIngredient } from '../../shared/stock-link.ts';
import { localDay } from '../../shared/dates.ts';
import type { Author, ShoppingItem, ShoppingLater, ShoppingMenuMark, StockData } from '../../shared/types.ts';
import type { ListsStore } from '../sources/lists.ts';
import type { MenuData, MenuStore } from '../sources/menus.ts';
import type { RecipeStore } from '../sources/recipes.ts';
import type { StockStore } from '../sources/stock.ts';
import type { Clock } from '../sources/types.ts';

export type MenuService = {
  view(week: string): Promise<MenuView>;
  /** Fait suivre la liste de courses ; renvoie le nombre de lignes changées. */
  sync(by: Author): Promise<number>;
  /** Synchronise si le jour a changé depuis la dernière fois (ou au démarrage). */
  refreshIfNewDay(): Promise<void>;
  /** Frais des semaines actives qui attendent « À acheter plus tard », par jour d'achat. */
  later(): Promise<ShoppingLater[]>;
  /** Une ligne du menu retirée à la main : « j'en ai déjà » pour sa semaine, puis synchronisation. */
  lineRemoved(item: ShoppingItem, by: Author): Promise<void>;
  /** Placards, produits reliés et contenants pleins, par ingrédient : de quoi proposer le décompte « J'ai cuisiné ». */
  cookContext(): Promise<CookContext>;
};

const SYSTEM: Author = { ownerId: null, via: 'tablet' };

type Snapshot = { menu: MenuData; recipes: Recipe[]; stock: StockData; current: string; today: string };

/** Ingrédients connus du carnet (notre version de chaque recette), un par clé. */
function knownIngredients(recipes: readonly Recipe[]): KnownIngredient[] {
  const known = new Map<string, KnownIngredient>();
  for (const r of recipes) for (const line of r.ours.ingredients) if (line.key && !known.has(line.key)) known.set(line.key, { key: line.key, name: line.name });
  return [...known.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function createMenuService({ menus, recipes, stock, lists, clock }: { menus: MenuStore; recipes: RecipeStore; stock: StockStore; lists: ListsStore; clock: Clock }): MenuService {
  let syncedDay: string | null = null;

  async function snapshot(): Promise<Snapshot> {
    const [menu, all, stockData] = await Promise.all([menus.data(), recipes.all(), stock.data()]);
    const now = clock();
    return { menu, recipes: all, stock: stockData, current: weekOf(now), today: localDay(now) };
  }

  const recipeLookup = (all: readonly Recipe[]) => {
    const byId = new Map(all.map((r) => [r.id, r]));
    return (id: string): MenuRecipe | null => byId.get(id)?.ours ?? null;
  };

  const largestOf = (snap: Snapshot) => largestNeeds(snap.recipes.map((r) => r.ours));
  /**
   * « S'utilise en plusieurs fois » : la valeur du lien, sinon devinée. Jamais deviné pour un produit sans code-barres :
   * sa contenance est déjà ce qui reste (« il reste 800 g »), pas un paquet peut-être entamé.
   */
  const partialOf = (code: string, link: StockLink | null, largest: ReadonlyMap<string, Quantities>) =>
    link ? (link.partial ?? (!isLooseCode(code) && guessPartial(link.per, largest.get(link.key)))) : false;

  function poolOf(snap: Snapshot): StockPool {
    const largest = largestOf(snap);
    return stockPool(
      snap.stock.items.map((i) => {
        const link = snap.menu.links[i.product.code] ?? null;
        return { name: i.product.current.name, count: i.quantity, link, partial: partialOf(i.product.code, link, largest), opened: i.opened };
      }),
    );
  }

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
    const packs = packSizes(Object.values(snap.menu.links));
    const result = new Map<string, PlanLine[]>();
    for (const week of activeWeeks(snap)) {
      // Repas cuisinés : leurs ingrédients qui ont eu une réponse ne comptent plus, ni dans le besoin ni dans l'acheté.
      const needs = aggregateNeeds(snap.menu.weeks[week], recipeOf);
      const bought = withoutCooked(boughtFor(shopping, cleared, week), cookedParts(snap.menu.weeks[week], recipeOf));
      const checks = new Map(Object.entries(snap.menu.checks[week] ?? {}));
      const later = { today: snap.today, advanced: new Set(snap.menu.now[week] ?? []) };
      result.set(week, planNeeds(needs, { pantry, have: new Set(snap.menu.have[week] ?? []), manual, bought, stock: pool, checks, packs, later }));
    }
    return result;
  }

  async function sync(by: Author): Promise<number> {
    const snap = await snapshot();
    syncedDay = snap.today;
    return lists.syncMenu((shopping, cleared) => {
      const desired: DesiredLine[] = [];
      for (const [week, lines] of plans(snap, shopping, cleared)) desired.push(...desiredLines(lines, week));
      return syncOps(shopping, desired);
    }, by);
  }

  /** Produits du stock à relier : ceux qui ressemblent à un ingrédient, ou déjà décidés ; la semaine d'abord. */
  function stockProducts(snap: Snapshot, weekKeys: ReadonlySet<string>): MenuStockProduct[] {
    const known = knownIngredients(snap.recipes);
    const largest = largestOf(snap);
    const products: MenuStockProduct[] = [];
    for (const item of snap.stock.items) {
      const { code, current, categories } = item.product;
      const decided = code in snap.menu.links;
      const guess = decided ? null : guessStock({ ...current, categories }, known);
      const link = decided ? snap.menu.links[code] : (guess?.link ?? null);
      if (!decided && (!link || item.quantity === 0)) continue;
      const partialGuessed = link?.partial === undefined;
      products.push({ code, name: current.name, quantity: current.quantity, count: item.quantity, link, decided, partial: partialOf(code, link, largest), partialGuessed, byCategory: guess?.from === 'category' });
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
        plan = planNeeds(needs, {
          pantry: snap.menu.pantry.map(labelKey),
          have: new Set(snap.menu.have[week] ?? []),
          manual: new Set(),
          bought: new Map(),
          stock: new Map(),
          checks: new Map(),
          packs: new Map(),
        });

      }
      return {
        week,
        current: snap.current,
        editable: week >= snap.current,
        today: snap.today,
        cookable: cookWindow(week, snap.today),
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

    async refreshIfNewDay() {
      if (syncedDay !== localDay(clock())) await sync(SYSTEM);
    },

    async later() {
      const snap = await snapshot();
      const { shopping } = await lists.lists();
      const cleared = await lists.cleared();
      return [...plans(snap, shopping, cleared)].flatMap(([week, lines]) => laterLines(lines, week)).sort((a, b) => a.day.localeCompare(b.day));
    },

    async cookContext() {
      const snap = await snapshot();
      const largest = largestOf(snap);
      const products = new Map<string, CookProduct[]>();
      const containers = new Map<string, CookContainer[]>();
      const keyOf = new Map<string, string>();
      for (const item of snap.stock.items) {
        const link = snap.menu.links[item.product.code];
        if (!link) continue;
        keyOf.set(item.product.code, link.key);
        const list = products.get(link.key) ?? [];
        list.push({ code: item.product.code, name: item.product.current.name, count: item.quantity, per: link.per, partial: partialOf(item.product.code, link, largest), opened: item.opened });
        products.set(link.key, list);
      }
      for (const c of snap.stock.containers) {
        const key = c.productCode ? keyOf.get(c.productCode) : undefined;
        if (!key || !c.full || !c.productCode) continue;
        containers.set(key, [...(containers.get(key) ?? []), { id: c.id, name: c.name, productCode: c.productCode }]);
      }
      return { pantry: snap.menu.pantry.map(labelKey), products, containers };
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
