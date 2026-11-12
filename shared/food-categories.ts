// Catégories Open Food Facts d'un produit (« en:milks », « fr:lardons-fumes »…, copiées dans le stock au scan) ramenées
// à des ingrédients de recette : « en:grated-cheeses » → fromage râpé, puis fromage. Sert à proposer le produit du
// stock relié à un ingrédient quand son nom ne suffit pas (« Chocolat au lait » n'est pas du lait, « Fol Épi » est un
// fromage). Une table à la main pour les catégories canoniques (en anglais), les mots pour les catégories françaises.
import { fold, ingredientKey } from './ingredients.ts';

export type KnownIngredient = { key: string; name: string };

/**
 * Catégorie canonique → ingrédients, le plus précis d'abord (le premier connu du carnet l'emporte). Les catégories
 * plus larges de la hiérarchie (en:cheeses au-dessus de en:grated-cheeses) donnent les replis suivants.
 */
const CATEGORY_INGREDIENTS: Record<string, readonly string[]> = {
  // Crèmerie
  'en:milks': ['lait'],
  'en:semi-skimmed-milks': ['lait demi-écrémé', 'lait'],
  'en:whole-milks': ['lait entier', 'lait'],
  'en:skimmed-milks': ['lait écrémé', 'lait'],
  'en:coconut-milks': ['lait de coco'],
  'en:creams': ['crème'],
  'en:fresh-creams': ['crème fraîche', 'crème'],
  'en:light-creams': ['crème légère', 'crème fraîche', 'crème'],
  'en:cooking-creams': ['crème liquide', 'crème'],
  'en:whipping-creams': ['crème liquide', 'crème entière', 'crème'],
  'en:butters': ['beurre'],
  'en:salted-butters': ['beurre demi-sel', 'beurre'],
  'en:unsalted-butters': ['beurre doux', 'beurre'],
  'en:eggs': ['œuf'],
  'en:chicken-eggs': ['œuf'],
  'en:cheeses': ['fromage'],
  'en:grated-cheeses': ['fromage râpé', 'gruyère', 'emmental', 'fromage'],
  'en:emmentaler': ['emmental', 'gruyère'],
  'en:gruyere': ['gruyère', 'emmental'],
  'en:comte': ['comté'],
  'en:mozzarella': ['mozzarella'],
  'en:parmigiano-reggiano': ['parmesan'],
  'en:goat-cheeses': ['fromage de chèvre', 'chèvre'],
  'en:feta': ['feta'],
  'en:yogurts': ['yaourt'],
  // Boucherie, charcuterie, poisson
  'en:lardons': ['lardon'],
  'en:hams': ['jambon'],
  'en:white-hams': ['jambon blanc', 'jambon'],
  'en:chickens': ['poulet'],
  'en:chicken-breasts': ['blanc de poulet', 'escalope de poulet', 'poulet'],
  'en:ground-beef': ['bœuf haché', 'viande hachée', 'steak haché'],
  'en:canned-tunas': ['thon'],
  'en:tunas': ['thon'],
  'en:sardines': ['sardine'],
  // Épicerie
  'en:pastas': ['pâtes'],
  'en:spaghetti': ['spaghetti', 'pâtes'],
  'en:penne': ['penne', 'pâtes'],
  'en:fusilli': ['fusilli', 'pâtes'],
  'en:tagliatelle': ['tagliatelle', 'pâtes'],
  'en:rices': ['riz'],
  'en:basmati-rices': ['riz basmati', 'riz'],
  'en:flours': ['farine'],
  'en:wheat-flours': ['farine de blé', 'farine'],
  'en:sugars': ['sucre'],
  'en:white-sugars': ['sucre en poudre', 'sucre'],
  'en:brown-sugars': ['sucre roux', 'cassonade', 'sucre'],
  'en:icing-sugars': ['sucre glace', 'sucre'],
  'en:vanilla-sugars': ['sucre vanillé'],
  'en:baking-powders': ['levure chimique'],
  'en:almond-powders': ['poudre d’amande', 'amande en poudre'],
  'en:breadcrumbs': ['chapelure'],
  'en:olive-oils': ['huile d’olive', 'huile'],
  'en:extra-virgin-olive-oils': ['huile d’olive', 'huile'],
  'en:sunflower-oils': ['huile de tournesol', 'huile'],
  'en:vegetable-oils': ['huile'],
  'en:vinegars': ['vinaigre'],
  'en:salts': ['sel'],
  'en:black-peppers': ['poivre'],
  'en:mustards': ['moutarde'],
  'en:dijon-mustards': ['moutarde de Dijon', 'moutarde'],
  'en:mayonnaises': ['mayonnaise'],
  'en:stocks': ['bouillon'],
  'en:bouillon-cubes': ['bouillon cube', 'bouillon'],
  'en:tomato-sauces': ['sauce tomate', 'coulis de tomate'],
  'en:crushed-tomatoes': ['tomate concassée', 'pulpe de tomate'],
  'en:peeled-tomatoes': ['tomate pelée'],
  'en:tomato-pastes': ['concentré de tomate'],
  'en:chickpeas': ['pois chiche'],
  'en:lentils': ['lentille'],
  'en:green-lentils': ['lentille verte', 'lentille'],
  'en:red-kidney-beans': ['haricot rouge'],
  'en:sweet-corn': ['maïs'],
  'en:coffees': ['café'],
  'en:ground-coffees': ['café moulu', 'café'],
  'en:teas': ['thé'],
  'en:chocolates': ['chocolat'],
  'en:dark-chocolates': ['chocolat noir', 'chocolat'],
  'en:milk-chocolates': ['chocolat au lait', 'chocolat'],
  'en:cooking-chocolates': ['chocolat pâtissier', 'chocolat noir', 'chocolat'],
  'en:honeys': ['miel'],
  'en:jams': ['confiture'],
  'en:breads': ['pain'],
  'en:sliced-breads': ['pain de mie'],
  'en:puff-pastries': ['pâte feuilletée'],
  'en:shortcrust-pastries': ['pâte brisée'],
  'en:pizza-doughs': ['pâte à pizza'],
  // Fruits et légumes
  'en:onions': ['oignon'],
  'en:potatoes': ['pomme de terre'],
  'en:carrots': ['carotte'],
  'en:garlic': ['ail'],
  'en:shallots': ['échalote'],
  'en:tomatoes': ['tomate'],
  'en:lemons': ['citron'],
  'en:apples': ['pomme'],
  'en:bananas': ['banane'],
};

const STOP_WORDS = new Set(['de', 'd', 'du', 'des', 'a', 'au', 'aux', 'en', 'l', 'la', 'le', 'les', 'et']);
const wordsOfKey = (key: string) => key.split('-').filter((w) => w && !STOP_WORDS.has(w));

/** Ingrédient du carnet qui précise un nom (« thon au naturel » pour « thon ») : mêmes premiers mots, le plus court. */
function refinement(words: readonly string[], known: readonly KnownIngredient[]): KnownIngredient | null {
  let best: KnownIngredient | null = null;
  let bestSize = Infinity;
  for (const ingredient of known) {
    const parts = wordsOfKey(ingredient.key);
    if (parts.length <= words.length || parts.length >= bestSize || !words.every((w, i) => parts[i] === w)) continue;
    best = ingredient;
    bestSize = parts.length;
  }
  return best;
}

/** Ingrédient deviné d'après les catégories : connu du carnet (`known`) ou seulement plausible. */
export type CategoryGuess = { ingredient: KnownIngredient; known: boolean };

/**
 * Ingrédient le plus probable d'après les catégories, la plus précise d'abord (Open Food Facts les donne de la plus
 * large à la plus précise). Pour chaque catégorie : un ingrédient du carnet qui en fait partie, sinon on passe à une
 * plus large. Catégorie canonique : ingrédients de la table, dans l'ordre, à clé égale, sinon un ingrédient du carnet
 * qui le précise (« thon au naturel » pour « thon »). Catégorie française
 * (« fr:lardons-fumes ») : un ingrédient du carnet dont tous les mots y sont et qui commence pareil (« lardon »,
 * jamais « lait » pour « fr:chocolats-au-lait »). Rien de connu : le premier ingrédient de la catégorie canonique la
 * plus précise de la table, à confirmer comme le reste.
 */
export function guessFromCategories(categories: readonly string[] | null | undefined, known: readonly KnownIngredient[]): CategoryGuess | null {
  if (!categories || categories.length === 0) return null;
  const byKey = new Map(known.map((k) => [k.key, k]));
  let plausible: KnownIngredient | null = null;
  for (const tag of [...categories].reverse()) {
    const names = CATEGORY_INGREDIENTS[tag];
    if (names) {
      for (const name of names) {
        const found = byKey.get(ingredientKey(name));
        if (found) return { ingredient: found, known: true };
      }
      for (const name of names) {
        const found = refinement(wordsOfKey(ingredientKey(name)), known);
        if (found) return { ingredient: found, known: true };
      }
      plausible ??= { key: ingredientKey(names[0]), name: names[0] };
      continue;
    }
    const french = /^fr:(.+)$/u.exec(tag)?.[1];
    if (!french) continue;
    const tagWords = wordsOfKey(ingredientKey(fold(french).replace(/-/gu, ' ')));
    const words = new Set(tagWords);
    let best: KnownIngredient | null = null;
    let bestSize = 0;
    for (const ingredient of known) {
      const parts = wordsOfKey(ingredient.key);
      if (parts.length === 0 || parts[0] !== tagWords[0] || !parts.every((p) => words.has(p))) continue;
      if (parts.length > bestSize) {
        best = ingredient;
        bestSize = parts.length;
      }
    }
    if (best) return { ingredient: best, known: true };
  }
  return plausible && { ingredient: plausible, known: false };
}

/** Catégories qu'on garde d'une fiche Open Food Facts : identifiants, sans doublons, au plus 30. */
export function cleanCategories(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const id = tag.trim().toLowerCase();
    if (/^[a-z]{2}:[\p{L}\p{N}-]{1,80}$/u.test(id)) seen.add(id);
    if (seen.size >= 30) break;
  }
  return [...seen];
}
