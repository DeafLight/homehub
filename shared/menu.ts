// Menu de la semaine et courses qui en découlent, partagé entre le serveur (qui calcule et synchronise la liste de
// courses) et le front (qui affiche). Une semaine commence le lundi ; chaque recette du menu (notre version) a un
// nombre de personnes et, si on veut, un jour. Les ingrédients de toutes les recettes de la semaine sont mis à
// l'échelle puis regroupés par clé normalisée (shared/ingredients.ts), quantités converties (shared/quantities.ts).
// Ensuite, ce qu'on a déjà est retiré, dans cet ordre : placards toujours ignorés, coche « j'en ai déjà », ligne
// ajoutée à la main pour le même ingrédient, déjà acheté (coché ou vidé du panier), puis le stock relié.
//
// Règle de synchronisation avec la liste de courses (syncOps) : chaque ligne du menu porte sa semaine et sa clé.
// - Une ligne du menu non cochée suit le calcul : mise à jour, ou retirée quand il n'y a plus rien à acheter
//   (recette retirée, personnes en moins, en stock, « j'en ai déjà », semaine passée).
// - Une ligne cochée n'est jamais touchée ; elle compte comme achetée, de même qu'une ligne vidée du panier pour
//   cette semaine : si le menu grandit ensuite, seule la différence revient, sur une nouvelle ligne.
// - Une ligne ajoutée à la main n'est jamais touchée ; si elle porte le même ingrédient (« Oignons »), elle
//   l'emporte : pas de ligne du menu en double.
// - Retirer à la main une ligne du menu vaut « j'en ai déjà » pour la semaine (géré par le serveur).
//
// Stock relié et paquet peut-être entamé (stockPool, planNeeds) : le stock sait qu'un paquet est entré et pas encore
// sorti, pas combien il en reste. Un produit qui s'utilise en plusieurs fois (gruyère, farine, beurre : lien
// `partial`, deviné quand un paquet couvre plus que le plus grand besoin d'une recette du carnet) a peut-être un
// paquet entamé : seuls (nombre − 1) paquets sont sûrs. Un produit utilisé en une fois (boîte, brique) compte en entier.
// - Les paquets sûrs suffisent : la ligne disparaît (« En stock »).
// - Sinon, si le paquet entamé, s'il était plein, comblerait le manque : « À vérifier au placard ». Sans décision,
//   la ligne reste dans les courses (en cas de doute, on achète), marquée à vérifier. « J'en ai assez » la retire
//   pour la semaine ; « Il en faut » la garde, sans le signal. Décision par semaine et par ingrédient.
// - Si même un paquet plein ne suffit pas : on achète la différence calculée sur les paquets sûrs.
// Un paquet jeté sans avoir été scanné est rattrapé par la même vérification. Le stock n'est jamais décompté quand on
// cuisine : il est consommé seulement dans le calcul, semaine après semaine (ce qui couvre l'une ne couvre plus l'autre).
//
// Arrondi au paquet (packsFor) : quand un produit est relié à l'ingrédient et que les unités se comparent, la ligne
// dit combien de paquets acheter (« 250 g (2 × 200 g) »).
import { localDay } from './dates.ts';
import { guessAisle, ingredientKey, parseIngredient } from './ingredients.ts';
import {
  addQuantities,
  type Amount,
  formatAmount,
  formatQuantities,
  isEmpty,
  type Quantities,
  quantitiesOf,
  scaleQuantities,
  subtractQuantities,
} from './quantities.ts';
import { type RecipeContent, scaleFactor } from './recipes.ts';
import type { Author, ShoppingMenuMark } from './types.ts';

export const MENU_LIMITS = { entries: 40, people: 50, pantry: 60, name: 80, weeksAhead: 4, weeksKept: 12 } as const;

/** Placards ignorés tant qu'on ne les a pas réglés. */
export const DEFAULT_PANTRY = ['sel', 'poivre', 'huile', 'eau'];

export type MenuEntry = {
  id: string;
  recipeId: string;
  /** Titre au moment de l'ajout : le menu passé reste lisible même si la recette quitte le carnet. */
  title: string;
  /** Personnes (ou portions, quand la recette compte autre chose : « 12 galettes »). */
  people: number;
  /** Jour (AAAA-MM-JJ, dans la semaine), ou null : « cette semaine ». */
  day: string | null;
  addedBy: Author;
  addedAt: string;
};

/** Ce qu'une recette apporte au calcul : notre version, ou null si elle n'est plus au carnet. */
export type MenuRecipe = Pick<RecipeContent, 'title' | 'servings' | 'servingsUnit' | 'ingredients'>;

export type NeedSource = { recipeId: string; title: string; count: number };

/** Un ingrédient de la semaine, toutes recettes confondues. */
export type Need = {
  key: string;
  /** Nom à afficher (celui de la première recette). */
  name: string;
  aisle: string | null;
  quantities: Quantities;
  /** Au moins une recette le donne sans quantité (« persil », « sel, poivre »). */
  toTaste: boolean;
  /** Facultatif dans toutes ses recettes. */
  optional: boolean;
  sources: NeedSource[];
};

// --- Semaines ---

const dayOf = (text: string) => {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Lundi de la semaine d'une date (AAAA-MM-JJ, heure locale). */
export function weekOf(date: Date): string {
  return localDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7)));
}

export function addWeeks(week: string, count: number): string {
  const d = dayOf(week);
  return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * count));
}

/** Les sept jours d'une semaine. */
export function weekDays(week: string): string[] {
  const d = dayOf(week);
  return Array.from({ length: 7 }, (_, i) => localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)));
}

/** Un lundi bien écrit (AAAA-MM-JJ). */
export const isWeek = (text: string) => /^\d{4}-\d{2}-\d{2}$/u.test(text) && weekOf(dayOf(text)) === text;

// --- Placards ---

/** Adjectifs qui ne changent pas l’ingrédient d’un placard (« gros sel », « sel fin »). */
const PANTRY_ADJECTIVES = new Set(['gros', 'fin', 'gris']);

/**
 * Un placard couvre sa clé et ses variantes : « huile » couvre « huile d'olive », « poivre » couvre « poivre du
 * moulin », « sel » couvre « gros sel » ; mais « sel » ne couvre pas « beurre demi-sel ».
 */
export function inPantry(key: string, pantry: readonly string[]): boolean {
  const words = key.split('-');
  return pantry.some((p) => p !== '' && (key === p || key.startsWith(`${p}-`) || (words.length === 2 && words[1] === p && PANTRY_ADJECTIVES.has(words[0]))));
}

/** Clé d'un placard ou d'une ligne écrite à la main (« Tomates » → « tomate », « 2 l de lait » → « lait »). */
export const labelKey = (label: string) => ingredientKey(parseIngredient(label).name);

// --- Agrégation ---

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/**
 * Ingrédients d'une semaine : chaque recette mise à l'échelle de ses personnes (portions de notre version, sinon
 * telle quelle), puis regroupés par clé. Une plage (« 2 à 3 ») compte pour sa borne haute : mieux vaut en avoir assez.
 * Une recette qui n'est plus au carnet n'apporte rien. `count` : nombre de fois où la recette est au menu.
 */
export function aggregateNeeds(entries: readonly MenuEntry[], recipeOf: (id: string) => MenuRecipe | null): Need[] {
  const needs = new Map<string, Need>();
  for (const entry of entries) {
    const recipe = recipeOf(entry.recipeId);
    if (!recipe) continue;
    const factor = scaleFactor(recipe.servings, entry.people);
    const seen = new Set<string>();
    for (const line of recipe.ingredients) {
      const key = line.key;
      if (!key) continue;
      let need = needs.get(key);
      if (!need) {
        need = { key, name: capitalize(line.name), aisle: line.aisle ?? guessAisle(key), quantities: {}, toTaste: false, optional: true, sources: [] };
        needs.set(key, need);
      }
      const amount = line.quantityMax ?? line.quantity;
      if (amount !== null && line.unit !== null) {
        need.quantities = addQuantities(need.quantities, scaleQuantities(quantitiesOf(amount, line.unit), factor));
      } else need.toTaste = true;
      need.optional &&= line.optional;
      // Un ingrédient cité deux fois dans la même recette ne compte qu'une fois la recette.
      if (seen.has(key)) continue;
      seen.add(key);
      const source = need.sources.find((s) => s.recipeId === entry.recipeId);
      if (source) source.count++;
      else need.sources.push({ recipeId: entry.recipeId, title: recipe.title, count: 1 });
    }
  }
  return [...needs.values()];
}

/**
 * Plus grand besoin d'une recette du carnet pour chaque ingrédient, recette telle qu'écrite (un ingrédient cité deux
 * fois dans la même recette s'additionne), grandeur par grandeur. Sert à deviner si un paquet s'utilise en plusieurs fois.
 */
export function largestNeeds(recipes: Iterable<Pick<MenuRecipe, 'ingredients'>>): Map<string, Quantities> {
  const largest = new Map<string, Quantities>();
  for (const recipe of recipes) {
    const own = new Map<string, Quantities>();
    for (const line of recipe.ingredients) {
      const amount = line.quantityMax ?? line.quantity;
      if (!line.key || amount === null || line.unit === null) continue;
      own.set(line.key, addQuantities(own.get(line.key) ?? {}, quantitiesOf(amount, line.unit)));
    }
    for (const [key, quantities] of own) {
      const best: Quantities = { ...largest.get(key) };
      for (const [dimension, value] of Object.entries(quantities)) best[dimension] = Math.max(best[dimension] ?? 0, value ?? 0);
      largest.set(key, best);
    }
  }
  return largest;
}

// --- Ce qu'on a déjà ---

export type Bought = { quantities: Quantities; toTaste: boolean };

/**
 * Stock relié aux ingrédients, par clé : la quantité sûre (paquets × contenance, sans le paquet peut-être entamé
 * d'un produit qui s'utilise en plusieurs fois), ce que ce paquet apporterait s'il était plein (`opened`, et les
 * produits concernés), et les produits qui la font. `unknown` : un produit relié sans contenance connue (on sait qu'il
 * y en a, pas combien). Consommé semaine après semaine : ce qui couvre cette semaine ne couvre plus la suivante.
 */
export type StockPool = Map<string, { quantities: Quantities; opened: Quantities; unknown: boolean; products: string[]; openedProducts: string[] }>;

/** Décision sur un ingrédient « à vérifier au placard », pour une semaine : assez à la maison, ou il en faut. */
export type CheckDecision = 'enough' | 'needed';
export const CHECK_DECISIONS = ['enough', 'needed'] as const satisfies readonly CheckDecision[];

/** Paquets à acheter d'un produit relié : « 2 × 200 g ». */
export type Packs = { count: number; per: Amount };

export type HaveState = {
  /** Clés des placards toujours ignorés. */
  pantry: readonly string[];
  /** Clés cochées « j'en ai déjà » pour cette semaine. */
  have: ReadonlySet<string>;
  /** Clés des lignes ajoutées à la main, non cochées. */
  manual: ReadonlySet<string>;
  /** Déjà acheté pour cette semaine (lignes du menu cochées, ou vidées du panier). */
  bought: ReadonlyMap<string, Bought>;
  stock: StockPool;
  /** Décisions « à vérifier au placard » de cette semaine, par clé. */
  checks: ReadonlyMap<string, CheckDecision>;
  /** Contenances des produits reliés à chaque clé (en stock ou non), pour l'arrondi au paquet. */
  packs: ReadonlyMap<string, readonly Amount[]>;
};

export type PlanStatus = 'buy' | 'pantry' | 'have' | 'manual' | 'bought' | 'stock';

/**
 * Stock trouvé pour une ligne : `quantities`, ce que les paquets sûrs couvrent ; `enough` false, il en manque ; null,
 * on ne peut pas comparer (à vérifier). `opened` : produits dont le paquet peut-être entamé comblerait le manque.
 */
export type StockNote = { quantities: Quantities; products: string[]; enough: boolean | null; opened: string[] };

/**
 * À vérifier au placard : `ask`, pas encore de décision (la ligne reste dans les courses, marquée) ; `enough`, « J'en
 * ai assez » (rien à acheter) ; `needed`, « Il en faut » (dans les courses, sans le signal). null : rien à vérifier.
 */
export type CheckState = 'ask' | CheckDecision;

export type PlanLine = Need & {
  /** « buy » : il reste à acheter `buy` ; sinon la raison pour laquelle il n'y a rien à acheter. */
  status: PlanStatus;
  buy: Quantities;
  /** À acheter sans quantité (« persil »). */
  buyToTaste: boolean;
  stock: StockNote | null;
  bought: Bought | null;
  check: CheckState | null;
  /** Paquets à acheter (ligne « buy » seulement, produit relié et unités qui se comparent). */
  packs: Packs | null;
};

/** Ce qui reste à acheter pour chaque ingrédient d'une semaine (le stock du `state` est consommé au passage). */
export function planNeeds(needs: readonly Need[], state: HaveState): PlanLine[] {
  return needs.map((need) => {
    const line = (status: PlanStatus, extra: Partial<PlanLine> = {}): PlanLine => ({
      ...need,
      status,
      buy: {},
      buyToTaste: false,
      stock: null,
      bought: null,
      check: null,
      packs: null,
      ...extra,
    });
    if (inPantry(need.key, state.pantry)) return line('pantry');
    if (state.have.has(need.key)) return line('have');
    if (state.manual.has(need.key)) return line('manual');

    let rest = need.quantities;
    let toTaste = need.toTaste;
    const bought = state.bought.get(need.key) ?? null;
    if (bought) {
      rest = subtractQuantities(rest, bought.quantities).rest;
      toTaste = false;
      if (isEmpty(rest)) return line('bought', { bought });
    }

    let stock: StockNote | null = null;
    let check: CheckState | null = null;
    const pool = state.stock.get(need.key);
    if (pool && (pool.unknown || !isEmpty(pool.quantities) || !isEmpty(pool.opened))) {
      // D'abord les paquets sûrs.
      const sure = subtractQuantities(rest, pool.quantities);
      const used = subtractQuantities(rest, sure.rest).rest;
      pool.quantities = subtractQuantities(pool.quantities, used).rest;
      let uncertain = sure.uncertain;
      if (!isEmpty(sure.rest) && !isEmpty(pool.opened)) {
        // Puis le paquet peut-être entamé, compté plein : s'il comblerait le manque, à vérifier au placard.
        const opened = subtractQuantities(sure.rest, pool.opened);
        if (isEmpty(opened.rest)) {
          check = state.checks.get(need.key) ?? 'ask';
          // « J'en ai assez » : ce paquet sert cette semaine, il ne couvre plus la suivante.
          if (check === 'enough') pool.opened = subtractQuantities(pool.opened, sure.rest).rest;
        } else uncertain ||= opened.uncertain;
      }
      const enough = isEmpty(sure.rest) || check === 'enough' ? true : check === null && (uncertain || (pool.unknown && isEmpty(used))) ? null : false;
      stock = { quantities: used, products: pool.products, enough, opened: check ? pool.openedProducts : [] };
      rest = sure.rest;
      toTaste = false;
      if (enough === true) return line('stock', { stock, bought, check });
    }
    if (isEmpty(rest) && !toTaste) return line(bought ? 'bought' : 'stock', { stock, bought });
    return line('buy', { buy: rest, buyToTaste: isEmpty(rest), stock, bought, check, packs: packsFor(rest, state.packs.get(need.key)) });
  });
}

// --- Liste de courses ---

/**
 * Paquets à acheter pour couvrir `buy`, d'après les contenances des produits reliés : le premier dont l'unité se
 * compare. null : plusieurs grandeurs à la fois (« 1 + 100 g »), rien à comparer, ou rien à acheter.
 */
export function packsFor(buy: Quantities, sizes: readonly Amount[] = []): Packs | null {
  const entries = Object.entries(buy).filter((e): e is [string, number] => (e[1] ?? 0) > 1e-9);
  if (entries.length !== 1) return null;
  const [dimension, value] = entries[0];
  for (const per of sizes) {
    const size = quantitiesOf(per.quantity, per.unit)[dimension];
    if (size) return { count: Math.max(1, Math.ceil(value / size - 1e-9)), per };
  }
  return null;
}

/** « 2 × 200 g ». */
export const formatPacks = (packs: Packs) => `${packs.count} × ${formatAmount(packs.per)}`;

/** Contenances des produits reliés, par clé, sans doublon (dans l'ordre des liens). */
export function packSizes(links: Iterable<StockLink | null>): Map<string, Amount[]> {
  const sizes = new Map<string, Amount[]>();
  for (const link of links) {
    const per = link?.per;
    if (!link || !per) continue;
    const list = sizes.get(link.key) ?? [];
    if (!list.some((a) => a.quantity === per.quantity && a.unit === per.unit)) list.push(per);
    sizes.set(link.key, list);
  }
  return sizes;
}

/** Libellé d'une ligne de courses : « Oignon · 2 + 100 g », « Gruyère · 250 g (2 × 200 g) », « Persil ». */
export function shoppingLabel(name: string, buy: Quantities, packs: Packs | null = null): string {
  const amount = formatQuantities(buy);
  if (!amount) return name;
  return packs ? `${name} · ${amount} (${formatPacks(packs)})` : `${name} · ${amount}`;
}

/** « Mijoté de lentilles ×2 ». */
export const sourceLabel = (s: NeedSource) => (s.count > 1 ? `${s.title} ×${s.count}` : s.title);

export type DesiredLine = { label: string; menu: ShoppingMenuMark };

/** Lignes que le menu met sur la liste de courses pour une semaine. */
export function desiredLines(plan: readonly PlanLine[], week: string): DesiredLine[] {
  return plan
    .filter((l) => l.status === 'buy')
    .map((l) => ({
      label: shoppingLabel(l.optional ? `${l.name} (facultatif)` : l.name, l.buy, l.packs),
      menu: {
        week,
        key: l.key,
        quantities: l.buy,
        toTaste: l.buyToTaste,
        aisle: l.aisle,
        sources: l.sources.map(sourceLabel),
        ...(l.check === 'ask' && { check: true }),
        ...(l.packs && { packs: l.packs }),
      },
    }));
}

type ShoppingLike = { id: string; label: string; done: boolean; menu?: ShoppingMenuMark };

/** Clés des lignes ajoutées à la main et pas encore cochées. */
export function manualKeys(items: readonly ShoppingLike[]): Set<string> {
  return new Set(items.filter((i) => !i.menu && !i.done).map((i) => labelKey(i.label)).filter(Boolean));
}

/** Déjà acheté pour une semaine : ses lignes du menu cochées, et celles vidées du panier (`cleared`). */
export function boughtFor(items: readonly ShoppingLike[], cleared: readonly ShoppingMenuMark[], week: string): Map<string, Bought> {
  const bought = new Map<string, Bought>();
  const marks = [...items.filter((i) => i.done && i.menu).map((i) => i.menu!), ...cleared];
  for (const mark of marks) {
    if (mark.week !== week) continue;
    const before = bought.get(mark.key) ?? { quantities: {}, toTaste: false };
    bought.set(mark.key, { quantities: addQuantities(before.quantities, mark.quantities), toTaste: before.toTaste || mark.toTaste });
  }
  return bought;
}

export type SyncOps = {
  add: DesiredLine[];
  update: (DesiredLine & { id: string })[];
  remove: string[];
};

const sameLine = (item: ShoppingLike, wanted: DesiredLine) => item.label === wanted.label && JSON.stringify(item.menu) === JSON.stringify(wanted.menu);

/**
 * Ce qu'il faut changer sur la liste de courses pour qu'elle suive le menu (voir la règle en tête du fichier) :
 * seules les lignes du menu non cochées bougent.
 */
export function syncOps(items: readonly ShoppingLike[], desired: readonly DesiredLine[]): SyncOps {
  const ops: SyncOps = { add: [], update: [], remove: [] };
  const open = new Map<string, ShoppingLike>();
  for (const item of items) {
    if (item.done || !item.menu) continue;
    const id = `${item.menu.week}|${item.menu.key}`;
    if (open.has(id)) ops.remove.push(item.id); // doublon (ligne décochée à côté de sa suite) : une seule reste
    else open.set(id, item);
  }
  for (const wanted of desired) {
    const id = `${wanted.menu.week}|${wanted.menu.key}`;
    const item = open.get(id);
    if (!item) ops.add.push(wanted);
    else if (!sameLine(item, wanted)) ops.update.push({ id: item.id, ...wanted });
    open.delete(id);
  }
  ops.remove.push(...[...open.values()].map((i) => i.id));
  return ops;
}

// --- Stock relié ---

/**
 * Produit du stock relié à un ingrédient : la clé, son nom, ce qu'un paquet en contient (null : inconnu), et s'il
 * s'utilise en plusieurs fois (`partial` ; absent : deviné, voir guessPartial dans shared/stock-link.ts).
 */
export type StockLink = { key: string; name: string; per: Amount | null; partial?: boolean };

/**
 * Stock relié, par clé, à partir des produits en stock et de leurs liens. `partial` : le produit s'utilise en
 * plusieurs fois (valeur du lien ou devinée) ; un de ses paquets est peut-être entamé, il n'est pas compté sûr.
 */
export function stockPool(items: readonly { name: string; count: number; link: StockLink | null; partial?: boolean }[]): StockPool {
  const pool: StockPool = new Map();
  for (const { name, count, link, partial = false } of items) {
    if (!link || count <= 0) continue;
    const entry = pool.get(link.key) ?? { quantities: {}, opened: {}, unknown: false, products: [], openedProducts: [] };
    if (link.per && partial) {
      entry.quantities = addQuantities(entry.quantities, quantitiesOf(link.per.quantity * (count - 1), link.per.unit));
      entry.opened = addQuantities(entry.opened, quantitiesOf(link.per.quantity, link.per.unit));
      entry.openedProducts.push(name);
    } else if (link.per) entry.quantities = addQuantities(entry.quantities, quantitiesOf(link.per.quantity * count, link.per.unit));
    else entry.unknown = true;
    entry.products.push(count > 1 ? `${count} × ${name}` : name);
    pool.set(link.key, entry);
  }
  return pool;
}

// --- Vue d'une semaine (GET /api/menu) ---

/** Recette du menu, avec ce qu'il faut pour l'afficher. `missing` : plus au carnet. */
export type MenuViewEntry = MenuEntry & { servings: number | null; servingsUnit: string | null; photo: boolean; missing: boolean };

/** Produit du stock, avec son lien vers un ingrédient : confirmé, refusé (null), ou deviné à confirmer. */
export type MenuStockProduct = {
  code: string;
  name: string;
  /** Contenance écrite sur le paquet. */
  quantity: string | null;
  /** Paquets en stock. */
  count: number;
  link: StockLink | null;
  /** Décision prise (lien confirmé ou « pas un ingrédient ») ; false : `link` est une proposition. */
  decided: boolean;
  /** S'utilise en plusieurs fois : valeur du lien, ou devinée quand `partialGuessed`. */
  partial: boolean;
  partialGuessed: boolean;
};


export type MenuView = {
  week: string;
  /** Semaine en cours. */
  current: string;
  /** Semaine en cours ou à venir (une semaine passée se consulte seulement). */
  editable: boolean;
  entries: MenuViewEntry[];
  /** Courses de la semaine, ingrédient par ingrédient, avec ce qu'on a déjà. */
  plan: PlanLine[];
  pantry: string[];
  /** Produits du stock qui ressemblent à un ingrédient, à relier (ceux de la semaine d'abord) ou déjà reliés. */
  stock: MenuStockProduct[];
  /** Ingrédients du carnet, pour choisir à la main à quoi relier un produit. */
  ingredients: { key: string; name: string }[];
};
