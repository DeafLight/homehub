// « J'ai cuisiné » : ce qu'on propose de retirer du stock après une recette, ingrédient par ingrédient (fonction pure,
// partagée entre le serveur, qui recalcule et vérifie tout, et le front, qui affiche). Notre version de la recette est
// mise à l'échelle des personnes (comme les courses ; une plage compte pour sa borne haute), puis chaque ingrédient
// donne une ligne :
// - placard toujours ignoré : ligne grise, sans réponse ;
// - sans produit relié : « pas suivi dans le stock » (regroupé, avec « Relier un produit ») ;
// - produit relié mais pas en stock d'après HomeHub : rien (jamais de stock négatif) ;
// - sinon une option par produit relié en stock (le premier est choisi) et par contenant de la maison plein :
//   · utilisé en une fois (boîte, brique), unités qui se comparent : − N, arrondi au paquet (packsFor) ;
//   · utilisé en plusieurs fois (`partial`) : « Paquet fini » ou « Il en reste » (à peu près ¼ · ½ · ¾), plus N
//     paquets finis quand le besoin dépasse un paquet ; le paquet déjà entamé compte pour sa part restante connue ;
//   · unités qui ne se comparent pas, ou contenance inconnue : compteur de paquets finis (il part du nombre de la
//     recette quand elle compte en boîtes, sachets…) ;
//   · à goût (« persil ») ou facultatif : rien de proposé ;
//   · contenant de la maison (recharge transvasée) : « Vide » ou « Il en reste ».
// Rien n'est choisi d'avance : la proposition est seulement écrite ; « Tout comme proposé » la choisit d'un geste.
// Fenêtre : un repas se note cuisiné (ou s'annule) tant que sa semaine est la semaine en cours, plus COOK_GRACE_DAYS.
import { guessAisle, type Unit } from './ingredients.ts';
import { addDays, inPantry, type MenuRecipe, packsFor, weekOf } from './menu.ts';
import { addQuantities, type Amount, formatQuantities, isEmpty, type Quantities, quantitiesOf, scaleQuantities } from './quantities.ts';
import { scaleFactor } from './recipes.ts';
import type { Author } from './types.ts';

/** « Il en reste à peu près » : ¼ · ½ · ¾ du paquet. */
export const ESTIMATES = [0.25, 0.5, 0.75] as const;
export type Estimate = (typeof ESTIMATES)[number];

/** Jours après la fin de la semaine du repas pendant lesquels on peut encore le noter cuisiné, ou l'annuler. */
export const COOK_GRACE_DAYS = 2;

/** Unités de recette qui comptent des paquets : le compteur part de ce nombre (« 2 boîtes » de thon). */
const PACK_UNITS: ReadonlySet<Unit> = new Set<Unit>(['boite', 'sachet', 'paquet', 'pot', 'tablette', 'rouleau', 'barquette', 'cube']);

/** Produit du stock relié à un ingrédient. `opened` : part restante connue du paquet entamé (null : inconnue). */
export type CookProduct = { code: string; name: string; count: number; per: Amount | null; partial: boolean; opened: number | null };

/** Contenant de la maison plein d'un produit relié. */
export type CookContainer = { id: string; name: string; productCode: string };

/**
 * Réponse sur une ligne : `unused` (pas utilisé), `remove` (N paquets finis, sortis du stock), `left` (N paquets finis,
 * le suivant entamé : il en reste à peu près `estimate`, null : on ne sait pas), `empty` (contenant vide), `kept`
 * (contenant : il en reste, rien ne bouge).
 */
export type CookAnswer =
  | { action: 'unused' }
  | { action: 'remove'; count: number }
  | { action: 'left'; finished: number; estimate: Estimate | null }
  | { action: 'empty' }
  | { action: 'kept' };

export type CookOptionKind = 'once' | 'partial' | 'count' | 'taste' | 'container';

/** Une façon de répondre sur une ligne : un produit relié en stock, ou un contenant. */
export type CookOption = {
  kind: CookOptionKind;
  /** Produit (code-barres) ; pour un contenant, le produit qu'il contient. */
  code: string;
  /** Contenant de la maison, pour `container`. */
  container: { id: string; name: string } | null;
  /** Nom à afficher (produit, ou contenant). */
  name: string;
  /** Paquets en stock (au plus ce qu'on peut retirer) ; 0 pour un contenant. */
  stock: number;
  per: Amount | null;
  partial: boolean;
  opened: number | null;
  /** Réponse proposée (écrite, jamais choisie d'avance) ; null : rien à proposer. */
  proposal: CookAnswer | null;
  /** Compteur (`count`) : d'où il part (le nombre de la recette, sinon 1). */
  counter: number;
};

/** Ligne du panneau : un ingrédient de la recette. */
export type CookLine = {
  key: string;
  name: string;
  quantities: Quantities;
  /** Sans quantité (« persil »). */
  toTaste: boolean;
  optional: boolean;
  aisle: string | null;
  /** `stock` : des options ; sinon pourquoi il n'y a rien à répondre. */
  status: 'pantry' | 'untracked' | 'absent' | 'stock';
  options: CookOption[];
  /** Produits reliés mais pas en stock (`absent`). */
  linked: string[];
};

/** Repas noté cuisiné (sur l'entrée du menu). `keys` : ingrédients qui ont eu une réponse. */
export type CookedMark = {
  at: string;
  by: Author;
  /** Identifiant commun des mouvements du stock de ce décompte. */
  cook: string;
  keys: string[];
  /** Personnes à table (« On était 3 »). */
  people: number;
  /** Ce que le décompte a effacé, rendu si on l'annule : coches « j'en ai déjà », décisions « j'en ai assez ». */
  cleared: { have: string[]; checks: string[] };
};

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** Une estimation (¼ · ½ · ¾) au plus près ; null : presque rien (le paquet est fini). */
export function roundEstimate(remaining: number): Estimate | null {
  if (remaining < 0.125) return null;
  return ESTIMATES.reduce((best, e) => (Math.abs(e - remaining) < Math.abs(best - remaining) ? e : best));
}

/** La seule grandeur d'un besoin qui se compare au paquet, ou null (« 2 boîtes » contre 140 g). */
function comparable(need: Quantities, per: Amount | null): { value: number; size: number } | null {
  if (!per) return null;
  const entries = Object.entries(need).filter((e): e is [string, number] => (e[1] ?? 0) > 1e-9);
  if (entries.length !== 1) return null;
  const [dimension, value] = entries[0];
  const size = quantitiesOf(per.quantity, per.unit)[dimension];
  return size ? { value, size } : null;
}

/**
 * Produit utilisé en plusieurs fois : le paquet entamé d'abord (pour sa part connue, sinon plein), puis les paquets
 * pleins ; N paquets finis, et ce qui reste du dernier entamé.
 */
export function partialProposal(value: number, size: number, stock: number, opened: number | null): CookAnswer {
  let need = value;
  let finished = 0;
  let available = (opened ?? 1) * size;
  while (finished < stock) {
    if (need >= available - 1e-9) {
      need -= available;
      finished += 1;
      available = size;
      if (need <= 1e-9) break;
      continue;
    }
    const estimate = roundEstimate((available - need) / size);
    return estimate === null ? { action: 'remove', count: finished + 1 } : { action: 'left', finished, estimate };
  }
  return { action: 'remove', count: Math.max(1, finished) };
}

function productOption(product: CookProduct, need: Quantities, toTaste: boolean, optional: boolean): CookOption {
  const base = { code: product.code, container: null, name: product.name, stock: product.count, per: product.per, partial: product.partial, opened: product.opened, counter: 1 };
  if (toTaste || optional) return { ...base, kind: 'taste', proposal: null };
  const match = comparable(need, product.per);
  if (!match) {
    // Unités qui ne se comparent pas : le compteur part du nombre de la recette quand elle compte des paquets.
    const entries = Object.entries(need).filter((e): e is [string, number] => (e[1] ?? 0) > 1e-9);
    const packs = entries.length === 1 && PACK_UNITS.has(entries[0][0] as Unit) ? Math.max(1, Math.ceil(entries[0][1] - 1e-9)) : null;
    const counter = Math.min(packs ?? 1, product.count);
    return { ...base, kind: 'count', counter, proposal: packs ? { action: 'remove', count: counter } : null };
  }
  if (product.partial) return { ...base, kind: 'partial', proposal: partialProposal(match.value, match.size, product.count, product.opened) };
  const packs = packsFor(need, product.per ? [product.per] : []);
  return { ...base, kind: 'once', proposal: { action: 'remove', count: Math.min(packs?.count ?? 1, product.count) } };
}

/** Ingrédients de la recette, regroupés par clé et mis à l'échelle des personnes. */
function recipeNeeds(recipe: MenuRecipe, people: number | null) {
  const factor = scaleFactor(recipe.servings, people);
  const needs = new Map<string, { key: string; name: string; aisle: string | null; quantities: Quantities; toTaste: boolean; optional: boolean }>();
  for (const line of recipe.ingredients) {
    if (!line.key) continue;
    const need = needs.get(line.key) ?? { key: line.key, name: capitalize(line.name), aisle: line.aisle ?? guessAisle(line.key), quantities: {}, toTaste: false, optional: true };
    const amount = line.quantityMax ?? line.quantity;
    if (amount !== null && line.unit !== null) need.quantities = addQuantities(need.quantities, scaleQuantities(quantitiesOf(amount, line.unit), factor));
    else need.toTaste = true;
    need.optional &&= line.optional;
    needs.set(line.key, need);
  }
  return [...needs.values()];
}

export type CookContext = {
  /** Clés des placards toujours ignorés. */
  pantry: readonly string[];
  /** Produits reliés, par clé d'ingrédient (en stock ou non). */
  products: ReadonlyMap<string, readonly CookProduct[]>;
  /** Contenants pleins d'un produit relié, par clé d'ingrédient. */
  containers: ReadonlyMap<string, readonly CookContainer[]>;
};

/** Les lignes du panneau « J'ai cuisiné » pour une recette et un nombre de personnes (null : telle qu'écrite). */
export function cookLines(recipe: MenuRecipe, people: number | null, context: CookContext): CookLine[] {
  return recipeNeeds(recipe, people).map((need) => {
    const line = (status: CookLine['status'], extra: Partial<CookLine> = {}): CookLine => ({ ...need, status, options: [], linked: [], ...extra });
    if (inPantry(need.key, context.pantry)) return line('pantry');
    const products = context.products.get(need.key) ?? [];
    const containers = context.containers.get(need.key) ?? [];
    if (products.length === 0 && containers.length === 0) return line('untracked');
    const inStock = products.filter((p) => p.count > 0).sort((a, b) => b.count - a.count);
    const options: CookOption[] = inStock.map((p) => productOption(p, need.quantities, need.toTaste || isEmpty(need.quantities), need.optional));
    for (const c of containers) {
      options.push({ kind: 'container', code: c.productCode, container: { id: c.id, name: c.name }, name: c.name, stock: 0, per: null, partial: false, opened: null, proposal: { action: 'kept' }, counter: 1 });
    }
    if (options.length === 0) return line('absent', { linked: products.map((p) => p.name) });
    return line('stock', { options });
  });
}

/** La réponse est-elle permise pour cette option (le serveur vérifie chaque ligne) ? */
export function validAnswer(option: CookOption, answer: CookAnswer): boolean {
  const whole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (option.kind === 'container') return answer.action === 'empty' || answer.action === 'kept';
  switch (answer.action) {
    case 'unused':
      return true;
    case 'remove':
      return whole(answer.count, 1, option.stock);
    case 'left':
      return (option.kind === 'partial' || option.kind === 'taste') && whole(answer.finished, 0, option.stock - 1) && (answer.estimate === null || ESTIMATES.includes(answer.estimate));
    default:
      return false;
  }
}

/** Ce qu'une réponse change au stock : paquets sortis, part restante du paquet entamé (undefined : inchangée), contenant vidé. */
export type CookEffect = { code: string; remove: number; opened?: number | null; container: string | null };

export function answerEffect(option: CookOption, answer: CookAnswer): CookEffect | null {
  if (option.kind === 'container') return answer.action === 'empty' ? { code: option.code, remove: 0, container: option.container?.id ?? null } : null;
  if (answer.action === 'remove') return { code: option.code, remove: answer.count, opened: null, container: null };
  if (answer.action === 'left') {
    // « Il en reste » sans estimation : le paquet est entamé, sans savoir combien ; seule une estimation se retient.
    if (answer.finished === 0 && answer.estimate === null) return null;
    return { code: option.code, remove: answer.finished, opened: answer.estimate, container: null };
  }
  return null;
}

/** Des paquets sont finis (« Paquet fini », « 2 finis », « Retirer 1 ») : pour les coches « j'en ai déjà » et « j'en ai assez ». */
export const finishesPack = (answer: CookAnswer) => (answer.action === 'remove' && answer.count > 0) || (answer.action === 'left' && answer.finished > 0) || answer.action === 'empty';

/** « Thon × 2 », « Penne (il en reste ½) », « Bocal à farine vide ». */
export function effectLabel(option: CookOption, answer: CookAnswer): string | null {
  const name = option.name.toLowerCase();
  if (answer.action === 'empty') return `${name} vide`;
  if (answer.action === 'remove') return answer.count > 1 ? `${name} × ${answer.count}` : name;
  if (answer.action === 'left' && (answer.finished > 0 || answer.estimate !== null)) {
    const left = answer.estimate !== null ? ` (il en reste ${estimateLabel(answer.estimate)})` : '';
    return `${answer.finished > 1 ? `${name} × ${answer.finished}` : name}${left}`;
  }
  return null;
}

export const estimateLabel = (estimate: number) => (estimate <= 0.25 ? '¼' : estimate <= 0.5 ? '½' : '¾');

/** « 400 g », vide sans quantité. */
export const needLabel = (line: Pick<CookLine, 'quantities'>) => formatQuantities(line.quantities);

/**
 * Un repas de cette semaine peut-il encore être noté cuisiné (ou annulé) aujourd'hui ? Semaine en cours, ou semaine
 * passée jusqu'à COOK_GRACE_DAYS jours après son dimanche ; jamais une semaine à venir.
 */
export function cookWindow(week: string, today: string): boolean {
  const day = new Date(`${today}T12:00:00`);
  return week <= weekOf(day) && today <= addDays(week, 6 + COOK_GRACE_DAYS);
}

// --- Échanges de l'API (GET/POST /api/menu/entries/:id/cook, /api/recipes/:id/cook, DELETE /api/cooks/:cook) ---

/** Un repas du menu qu'on peut noter cuisiné (ou déjà noté). */
export type CookMeal = { id: string; week: string; day: string | null; people: number; title: string; cooked: CookedMark | null };

/** Le panneau « J'ai cuisiné » : la recette, le repas (null : hors menu), les personnes et les lignes. */
export type CookProposal = {
  recipeId: string | null;
  title: string;
  meal: CookMeal | null;
  /** Repas de cette recette qu'on peut encore noter (pour « changer »). */
  meals: CookMeal[];
  people: number | null;
  servingsUnit: string | null;
  /** Recette retirée du carnet : « Cuisiné ? » note seulement le repas. */
  missing: boolean;
  lines: CookLine[];
};

/** Réponse donnée sur une ligne : l'ingrédient, l'option choisie (produit ou contenant) et la réponse. */
export type CookReply = { key: string; code: string; container: string | null; answer: CookAnswer };

/** Corps de POST …/cook : le repas (null : hors menu), les personnes, les réponses (aucune : « Ne rien retirer »). */
export type CookRequest = { entryId: string | null; people: number | null; replies: CookReply[] };

export type CookResult = {
  cook: string;
  mealId: string | null;
  /** « thon × 2 », « penne (il en reste ½) », « bocal à farine vide ». */
  removed: string[];
  /** Produits épuisés à proposer pour la liste de courses (regroupés), ou déjà ajoutés d'office. */
  propose: { code: string; label: string }[];
  added: string[];
  /** Coches « j'en ai déjà » retirées : de retour dans les courses pour ces repas. */
  returned: { name: string; sources: string[] }[];
};

/** Décompte annulé : `kept`, produits bougés depuis (à corriger sur la page Stock). */
export type CookUndo = { undone: number; kept: string[] };

/**
 * Le repas que le mode cuisine prend d'office pour une recette : celui d'aujourd'hui, sinon le plus récent pas encore
 * cuisiné (jour passé, puis sans jour) ; null : aucun (hors menu).
 */
export function defaultMeal<T extends { day: string | null; week: string; cooked?: CookedMark | null }>(meals: readonly T[], today: string): T | null {
  const open = meals.filter((m) => !m.cooked);
  const todays = open.find((m) => m.day === today);
  if (todays) return todays;
  const past = open.filter((m) => m.day !== null && m.day < today).sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''));
  if (past[0]) return past[0];
  return open.filter((m) => m.day === null).sort((a, b) => b.week.localeCompare(a.week))[0] ?? null;
}
