// Bases libres de produits (Open Food Facts et ses sœurs) : nom, marque, contenance d'un code-barres et, pour
// l'alimentaire, ses catégories (« en:grated-cheeses », pour deviner l'ingrédient de recette). Alimentaire
// d'abord, puis hygiène (Open Beauty Facts) et le reste (Open Products Facts : lessive, entretien…). Lecture seule,
// sans compte ; l'API demande seulement un User-Agent qui dit qui appelle.
import { cleanCategories } from '../../shared/food-categories.ts';
import type { ProductInfo } from '../../shared/types.ts';

export type BaseProduct = {
  info: Partial<ProductInfo> & { name: string };
  image: string | null;
  base: string;
  /** Catégories Open Food Facts, de la plus large à la plus précise ; vide pour les autres bases (hygiène, lessive). */
  categories: string[];
};

export type ProductBase = {
  /** Le produit, ou null s'il n'est dans aucune base. Lève une erreur si aucune base n'a répondu. */
  find(code: string): Promise<BaseProduct | null>;
};

const BASES = [
  { id: 'open-food-facts', host: 'https://world.openfoodfacts.org' },
  { id: 'open-beauty-facts', host: 'https://world.openbeautyfacts.org' },
  { id: 'open-products-facts', host: 'https://world.openproductsfacts.org' },
] as const;

const FIELDS = 'product_name_fr,product_name,generic_name_fr,brands,quantity,image_front_small_url,categories_tags';

type RawProduct = {
  product_name_fr?: string;
  product_name?: string;
  generic_name_fr?: string;
  brands?: string;
  quantity?: string;
  image_front_small_url?: string;
  categories_tags?: unknown;
};

const clean = (value: string | undefined) => {
  const text = value?.replace(/\s+/gu, ' ').trim();
  return text ? text : null;
};

/** Fiche de la base ramenée à ce qu'on garde ; `name` vide si la base n'a pas de nom (à saisir, le reste prérempli). */
export function toBaseProduct(raw: RawProduct, base: string): BaseProduct {
  return {
    info: {
      name: clean(raw.product_name_fr) ?? clean(raw.product_name) ?? clean(raw.generic_name_fr) ?? '',
      // Plusieurs marques séparées par des virgules : la première (« Carrefour Kids, Carrefour »).
      brand: clean(raw.brands?.split(',')[0]),
      quantity: clean(raw.quantity),
    },
    image: clean(raw.image_front_small_url),
    base,
    // Seules les catégories alimentaires servent : celles d'Open Beauty Facts (« fr:laits-corporels ») tromperaient.
    categories: base === 'open-food-facts' ? cleanCategories(raw.categories_tags) : [],
  };
}

export function createOpenFoodFactsClient({
  fetchFn = (...args) => fetch(...args),
  userAgent,
  timeoutMs = 6000,
}: {
  fetchFn?: typeof fetch;
  userAgent: string;
  timeoutMs?: number;
}): ProductBase {
  async function ask(host: string, code: string): Promise<RawProduct | null> {
    const res = await fetchFn(`${host}/api/v2/product/${code}?fields=${FIELDS}`, {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${host} : HTTP ${res.status}`);
    const body = (await res.json()) as { status?: number; product?: RawProduct };
    return body.status === 1 && body.product ? body.product : null;
  }

  return {
    async find(code) {
      let answered = false;
      let lastError: unknown;
      for (const { id, host } of BASES) {
        try {
          const raw = await ask(host, code);
          answered = true;
          if (raw) return toBaseProduct(raw, id);
        } catch (err) {
          lastError = err;
        }
      }
      if (!answered) throw lastError instanceof Error ? lastError : new Error('Bases de produits injoignables');
      return null;
    },
  };
}
