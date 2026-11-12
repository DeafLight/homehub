// Règles du stock, sans HTTP : ce qu'est un code scanné (contenant, produit connu relu dans la base quand sa fiche
// est ancienne, ou inconnu), relecture de la base, mouvements avec leur suite sur la liste de courses (produit épuisé :
// ajouté d'office ou proposé ; annulé : l'article ajouté repart), produits sans code-barres (jamais cherchés dans la
// base). Le magasin garde l'état ; ce service décide.
import { isContainerCode, isLooseCode } from '../../shared/barcode.ts';
import { type LooseUnit, looseStock } from '../../shared/loose.ts';
import type { Author, Product, ProductInfo, ProductRecheck, ScanLookup, ShoppingItem, ShoppingOutcome, StockMovementResult } from '../../shared/types.ts';
import type { ListsStore } from '../sources/lists.ts';
import type { ProductBase } from '../sources/open-food-facts.ts';
import { type BaseReading, needsBaseRead, shoppingLabel, type StockStore } from '../sources/stock.ts';
import type { Clock } from '../sources/types.ts';

/** Refus métier, traduit en réponse par la couche HTTP. */
export type StockRefusal = { refused: 'unknown-product' | 'unknown-container' | 'base-unreachable' | 'not-in-base' | 'newer-movement' | 'no-movement' };

export type StockService = {
  /** null : étiquette de contenant inconnue. */
  scan(code: string): Promise<ScanLookup | null>;
  /** null : produit inconnu. */
  recheck(code: string): Promise<ProductRecheck | null>;
  acceptBase(code: string): Promise<Product | StockRefusal>;
  stockIn(code: string, count: number, price: number | null, by: Author): Promise<StockMovementResult | StockRefusal>;
  stockOut(code: string, options: { all: boolean; refill: string | null; remaining: number }, by: Author): Promise<StockMovementResult | StockRefusal>;
  emptyContainer(id: string, by: Author): Promise<StockMovementResult | StockRefusal>;
  undo(movementId: string): Promise<{ quantity: number } | StockRefusal>;
  /** « Oui » à la proposition : sur la liste de courses ; `always` : d'office la prochaine fois. */
  shop(code: string, always: boolean, by: Author): Promise<ShoppingItem | StockRefusal>;
  /** Produit sans code-barres (« 1,2 kg » de pommes, « 6 » œufs) : créé et entré au stock. */
  addLoose(input: { name: string; category: string | null; amount: number; unit: LooseUnit }, by: Author): Promise<StockMovementResult>;
  /** Nouvelle quantité d'un produit sans code-barres (plus de zéro : pour l'épuiser, la sortie « tout »). */
  setLoose(code: string, amount: number, unit: LooseUnit, by: Author): Promise<StockMovementResult | StockRefusal>;
};

export type StockServiceDeps = {
  stock: StockStore;
  /** Base de produits (Open Food Facts…) ; absente : tout inconnu se saisit à la main. */
  productBase?: ProductBase;
  lists: ListsStore;
  clock: Clock;
  logger?: Pick<Console, 'error'>;
};

export const isRefusal = (value: unknown): value is StockRefusal => typeof value === 'object' && value !== null && 'refused' in value;

const sameInfo = (a: ProductInfo, b: ProductInfo) => a.name === b.name && a.brand === b.brand && a.quantity === b.quantity;
const refuse = (refused: StockRefusal['refused']): StockRefusal => ({ refused });

export function createStockService({ stock, productBase, lists, clock, logger = console }: StockServiceDeps): StockService {
  /** La base, ramenée à une fiche ; `null` : absent de la base ; lève une erreur si la base ne répond pas. */
  async function readBase(code: string): Promise<BaseReading | null> {
    // Identifiant interne (produit sans code-barres, ou étiquette de pesée d'un magasin) : rien à demander à la base.
    if (!productBase || isLooseCode(code)) return null;
    const found = await productBase.find(code);
    if (!found) return null;
    const { name, brand = null, quantity = null } = found.info;
    return { info: { name, brand, quantity, category: null }, image: found.image, base: found.base, categories: found.categories };
  }

  /** Produit épuisé : ajouté d'office à la liste de courses, ou proposé. Déjà sur la liste : rien à faire. */
  async function shoppingFor(code: string | null, exhausted: boolean, autoShop: boolean, movementId: string, by: Author) {
    const product = code ? await stock.product(code) : null;
    const none = (label: string | null) => ({ shopping: 'none' as ShoppingOutcome, shoppingLabel: label });
    if (!product || !exhausted) return none(product ? shoppingLabel(product) : null);
    const label = shoppingLabel(product);
    const already = (await lists.lists()).shopping.some((s) => !s.done && s.label.toLowerCase() === label.toLowerCase());
    if (already) return none(label);
    if (!autoShop) return { shopping: 'propose' as ShoppingOutcome, shoppingLabel: label };
    const item = await lists.addShopping(label, by);
    await stock.attachShopping(movementId, item.id);
    return { shopping: 'added' as ShoppingOutcome, shoppingLabel: label };
  }

  /** Mouvement sans suite sur la liste de courses (entrée, inventaire). */
  const plainMovement = ({ movementId, at, quantity }: { movementId: string; at: string; quantity: number }, product: Product, by: Author): StockMovementResult => ({
    movementId,
    at,
    by,
    product,
    quantity,
    container: null,
    forgotten: false,
    shopping: 'none',
    shoppingLabel: null,
  });

  return {
    async scan(code) {
      if (isContainerCode(code)) {
        const container = await stock.container(code);
        return container && { kind: 'container', code, container };
      }
      let product = await stock.product(code);
      if (needsBaseRead(product, clock()) && productBase) {
        try {
          const reading = await readBase(code);
          if (reading?.info.name) product = await stock.saveFromBase(code, reading);
          else if (!product) {
            const suggestion = reading ? { brand: reading.info.brand, quantity: reading.info.quantity } : null;
            return { kind: 'unknown', code, suggestion, baseError: false };
          }
        } catch (err) {
          logger.error(`Base de produits (${code}) : ${(err as Error).message}`);
          if (!product) return { kind: 'unknown', code, suggestion: null, baseError: true };
        }
      }
      if (!product) return { kind: 'unknown', code, suggestion: null, baseError: false };
      return { kind: 'product', code, product, quantity: await stock.quantity(code) };
    },

    async recheck(code) {
      const product = await stock.product(code);
      if (!product) return null;
      const { name, brand, quantity, category } = product.current;
      const current = { name, brand, quantity, category };
      try {
        const reading = await readBase(product.code);
        const base = reading?.info.name ? { ...reading.info, category } : null;
        return { current, base, differs: base !== null && !sameInfo(current, base), baseError: false };
      } catch (err) {
        logger.error(`Base de produits (${product.code}) : ${(err as Error).message}`);
        return { current, base: null, differs: false, baseError: true };
      }
    },

    async acceptBase(code) {
      let reading;
      try {
        reading = await readBase(code);
      } catch {
        return refuse('base-unreachable');
      }
      if (!reading?.info.name) return refuse('not-in-base');
      const product = await stock.saveFromBase(code, reading);
      return product.conflict ? ((await stock.resolveConflict(code, 'base')) as Product) : product;
    },

    async stockIn(code, count, price, by) {
      const product = await stock.product(code);
      if (!product) return refuse('unknown-product');
      return plainMovement(await stock.add(product.code, count, price, by), product, by);
    },

    async stockOut(code, { all, refill, remaining }, by) {
      const product = await stock.product(code);
      if (!product) return refuse('unknown-product');
      if (refill && !(await stock.data()).containers.some((ct) => ct.id === refill)) return refuse('unknown-container');
      const result = await stock.remove(product.code, { all, refill, remaining }, by);
      const shopping = await shoppingFor(product.code, result.exhausted, result.autoShop, result.movementId, by);
      return {
        movementId: result.movementId,
        at: result.at,
        by,
        product: await stock.product(product.code),
        quantity: result.quantity,
        container: result.container,
        forgotten: result.forgotten,
        ...shopping,
      };
    },

    async emptyContainer(id, by) {
      const result = await stock.emptyContainer(id, by);
      if (!result) return refuse('unknown-container');
      const { productCode } = result;
      const shopping = await shoppingFor(productCode, result.exhausted, result.autoShop, result.movementId, by);
      return {
        movementId: result.movementId,
        at: result.at,
        by,
        product: productCode ? await stock.product(productCode) : null,
        quantity: productCode ? await stock.quantity(productCode) : 0,
        container: result.container,
        forgotten: false,
        ...shopping,
      };
    },

    async undo(movementId) {
      const result = await stock.undo(movementId);
      if (!result.ok) return refuse(result.code ? 'newer-movement' : 'no-movement');
      // L'article ajouté d'office à la liste de courses part avec, s'il n'a pas encore été acheté.
      if (result.shoppingId) {
        const item = (await lists.lists()).shopping.find((s) => s.id === result.shoppingId);
        if (item && !item.done) await lists.removeShopping(item.id);
      }
      return { quantity: result.code ? await stock.quantity(result.code) : 0 };
    },

    async shop(code, always, by) {
      const product = await stock.product(code);
      if (!product) return refuse('unknown-product');
      if (always) await stock.setPreferences(product.code, { autoShop: true });
      return lists.addShopping(shoppingLabel(product), by);
    },

    async addLoose({ name, category, amount, unit }, by) {
      const { count, quantity } = looseStock(amount, unit);
      const { product, ...movement } = await stock.addLoose({ name, brand: null, quantity, category }, count, by);
      return plainMovement(movement, product, by);
    },

    async setLoose(code, amount, unit, by) {
      const result = await stock.setLoose(code, looseStock(amount, unit), by);
      if (!result) return refuse('unknown-product');
      const { product, ...movement } = result;
      return plainMovement(movement, product, by);
    },
  };
}
