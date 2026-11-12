// Correspondance devinée entre un produit du stock et un ingrédient de recette, à confirmer une fois (puis retenue par
// produit) : « Lardons fumés · 2 x 75 g » → lardon, 150 g par paquet ; « Lait demi-écrémé · 1 L » → lait, 1 l.
// D'après les mots du nom (au singulier, sans accents), les catégories Open Food Facts copiées au scan (voir
// shared/food-categories.ts), le rayon choisi (l'entretien et l'hygiène ne se mangent pas) et la contenance écrite sur
// le paquet. Aucun appel à un service. Devine aussi si le produit s'utilise en plusieurs fois.
import { guessFromCategories, type KnownIngredient } from './food-categories.ts';
import { fold, guessAisle, ingredientKey, singular } from './ingredients.ts';
import type { StockLink } from './menu.ts';
import { type Amount, parsePackage, type Quantities, quantitiesOf } from './quantities.ts';
import type { ProductInfo } from './types.ts';

export type { KnownIngredient };

/** Produit tel qu'on le devine : sa fiche et ses catégories Open Food Facts (null ou absentes : jamais copiées). */
export type GuessedProduct = Pick<ProductInfo, 'name' | 'quantity' | 'category'> & { categories?: readonly string[] | null };

/** Correspondance devinée, et d'où elle vient : les mots du nom, ou les catégories Open Food Facts. */
export type StockGuess = { link: StockLink; from: 'name' | 'category' };

/** Rayons choisis à la main qui ne contiennent pas d'ingrédients. */
const NOT_FOOD = /entretien|hygi[eè]ne|beaut[eé]|droguerie|lessive|m[eé]nage|maison|b[eé]b[eé]|animaux|bricolage|papeterie/iu;
const STOP_WORDS = new Set(['de', 'd', 'du', 'des', 'a', 'au', 'aux', 'en', 'l', 'la', 'le', 'les', 'et']);

/** Mots significatifs d'un texte, chacun au singulier et sans accents (« Lardons fumés » → lardon, fume). */
export function nameWords(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/u)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/u.test(w))
    .map((w) => ingredientKey(w));
}

const keyWords = (key: string) => key.split('-').filter((w) => w && !STOP_WORDS.has(w));

/** Ingrédient du carnet dont tous les mots sont dans le nom du produit, le plus précis d'abord (« lait de coco » avant « lait »). */
function nameMatch(words: ReadonlySet<string>, known: readonly KnownIngredient[]): KnownIngredient | null {
  let best: KnownIngredient | null = null;
  let bestScore = 0;
  for (const ingredient of known) {
    const parts = keyWords(ingredient.key);
    if (parts.length === 0 || !parts.every((p) => words.has(p))) continue;
    if (parts.length > bestScore) {
      best = ingredient;
      bestScore = parts.length;
    }
  }
  return best;
}

/**
 * Ingrédient probable d'un produit, toujours à confirmer. Dans l'ordre :
 * 1. un ingrédient du carnet trouvé dans le nom et qui en porte le premier mot (« Gruyère râpé » → gruyère) ;
 * 2. sinon, un ingrédient du carnet d'après les catégories Open Food Facts (« Chocolat au lait » → chocolat, pas
 *    lait ; « Fol Épi » → fromage) ;
 * 3. sinon, un ingrédient du carnet trouvé ailleurs dans le nom (« Filets de poulet » → poulet), sauf si les
 *    catégories proposent un autre ingrédient, même absent du carnet ;
 * 4. sinon, l'ingrédient des catégories, puis le premier mot du nom s'il a un rayon connu (« Riz basmati » → riz).
 * null : rien de plausible, ou un produit qui ne se mange pas (rayon choisi).
 */
export function guessStock(product: GuessedProduct, known: readonly KnownIngredient[]): StockGuess | null {
  if (product.category && NOT_FOOD.test(product.category)) return null;
  const nameList = nameWords(product.name);
  const fromName = nameMatch(new Set(nameList), known);
  const fromCategories = guessFromCategories(product.categories, known);
  const head = nameList[0];
  const link = (ingredient: KnownIngredient, from: StockGuess['from']): StockGuess => ({ link: { key: ingredient.key, name: ingredient.name, per: parsePackage(product.quantity) }, from });
  if (fromName && (fromName.key === fromCategories?.ingredient.key || (head !== undefined && keyWords(fromName.key).includes(head)))) return link(fromName, 'name');
  if (fromCategories?.known) return link(fromCategories.ingredient, 'category');
  if (fromName && !fromCategories) return link(fromName, 'name');
  if (fromCategories) return link(fromCategories.ingredient, 'category');
  if (nameList.length === 0) return null;
  const word = product.name.trim().split(/\s+/u)[0] ?? '';
  const first = nameWords(word)[0];
  if (!first || !guessAisle(first)) return null;
  return link({ key: first, name: singular(word.toLowerCase()) }, 'name');
}

/** La correspondance devinée seule (voir guessStock). */
export function guessStockLink(product: GuessedProduct, known: readonly KnownIngredient[]): StockLink | null {
  return guessStock(product, known)?.link ?? null;
}

/**
 * Un produit s'utilise-t-il en plusieurs fois (gruyère, farine, beurre) ? Deviné : un paquet couvre plus que le plus
 * grand besoin d'une recette du carnet pour cet ingrédient (`largest`, voir largestNeeds dans shared/menu.ts). Sans
 * contenance connue, sans recette qui en donne la quantité, ou dans une unité qui ne se compare pas (une boîte de thon
 * de 140 g contre « 1 boîte ») : non, le paquet compte en entier.
 */
export function guessPartial(per: Amount | null, largest: Quantities | undefined): boolean {
  if (!per || !largest) return false;
  const [dimension, size] = Object.entries(quantitiesOf(per.quantity, per.unit))[0] ?? [];
  const need = dimension ? largest[dimension] : undefined;
  return need !== undefined && size !== undefined && size > need + 1e-9;
}
