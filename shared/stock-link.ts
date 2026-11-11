// Correspondance devinée entre un produit du stock et un ingrédient de recette, à confirmer une fois (puis retenue par
// produit) : « Lardons fumés · 2 x 75 g » → lardon, 150 g par paquet ; « Lait demi-écrémé · 1 L » → lait, 1 l.
// D'après les mots du nom (au singulier, sans accents), le rayon choisi (l'entretien et l'hygiène ne se mangent pas)
// et la contenance écrite sur le paquet. Aucun service externe.
import { fold, guessAisle, ingredientKey, singular } from './ingredients.ts';
import type { StockLink } from './menu.ts';
import { parsePackage } from './quantities.ts';
import type { ProductInfo } from './types.ts';

export type KnownIngredient = { key: string; name: string };

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

/**
 * Ingrédient probable d'un produit : parmi les ingrédients connus (carnet, menu), celui dont tous les mots sont dans
 * le nom du produit, le plus précis d'abord (« lait de coco » avant « lait ») ; à défaut, le premier mot du nom s'il
 * a un rayon connu (« Riz basmati » → riz). null : rien de plausible, ou un produit qui ne se mange pas.
 */
export function guessStockLink(product: Pick<ProductInfo, 'name' | 'quantity' | 'category'>, known: readonly KnownIngredient[]): StockLink | null {
  if (product.category && NOT_FOOD.test(product.category)) return null;
  const words = new Set(nameWords(product.name));
  if (words.size === 0) return null;
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
  if (!best) {
    const word = product.name.trim().split(/\s+/u)[0] ?? '';
    const first = nameWords(word)[0];
    if (!first || !guessAisle(first)) return null;
    best = { key: first, name: singular(word.toLowerCase()) };
  }
  return { key: best.key, name: best.name, per: parsePackage(product.quantity) };
}
