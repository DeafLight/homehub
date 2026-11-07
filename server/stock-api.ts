// Routes du stock de la maison. Lecture ouverte comme le reste de l'API. Écriture : la tablette ou un téléphone
// appairé, sans exiger qu'une personne soit reconnue : pendant un scan la caméra lit les codes-barres, pas les visages.
// Le mouvement garde qui l'a fait quand on le sait (personne reconnue juste avant, ou profil du téléphone).
// Un produit épuisé peut aller sur la liste de courses de la famille : c'est la suite du scan, pas une écriture
// séparée sur la liste (qui demanderait d'être reconnu).
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { isContainerCode, isStockCode } from '../shared/barcode.ts';
import type { Author, ProductInfo, ProductRecheck, ScanLookup, ShoppingOutcome, StockMovementResult } from '../shared/types.ts';
import type { Access } from './access.ts';
import type { ListsStore } from './sources/lists.ts';
import type { ProductBase } from './sources/open-food-facts.ts';
import { FIELD_MAX, NAME_MAX, needsBaseRead, shoppingLabel, type StockStore } from './sources/stock.ts';
import type { Clock } from './sources/types.ts';

export type StockApiDeps = {
  stock: StockStore;
  /** Base de produits (Open Food Facts…) ; absente : tout inconnu se saisit à la main. */
  productBase?: ProductBase;
  lists: ListsStore;
  access: Access;
  clock: Clock;
  logger?: Pick<Console, 'error'>;
};

const optionalField = z
  .string()
  .trim()
  .max(FIELD_MAX)
  .nullish()
  .transform((v) => (v ? v : null));
const infoSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  brand: optionalField,
  quantity: optionalField,
  category: optionalField,
});
const code = z.string().refine(isStockCode, 'code-barres sur 13 chiffres attendu');
const inSchema = z.object({ code, count: z.number().int().min(1).max(99).default(1), price: z.number().min(0).max(10_000).nullish() });
const outSchema = z.object({
  code,
  all: z.boolean().default(false),
  refill: z.string().nullish(),
  remaining: z.number().int().min(0).max(99).default(0),
});
const quantitySchema = z.object({ code, quantity: z.number().int().min(0).max(999) });
const undoSchema = z.object({ movementId: z.string().min(1) });
const shopSchema = z.object({ code, always: z.boolean().default(false) });
const prefsSchema = z.object({ autoShop: z.boolean().nullable().optional(), refill: z.string().nullable().optional() });
const conflictSchema = z.object({ take: z.enum(['mine', 'base']) });
const containerSchema = z.object({ name: z.string().trim().min(1).max(FIELD_MAX) });
const settingsSchema = z.object({ autoShop: z.boolean() });

const body = async (c: Context) => c.req.json().catch(() => null);
const sameInfo = (a: ProductInfo, b: ProductInfo) => a.name === b.name && a.brand === b.brand && a.quantity === b.quantity;

export function createStockApi({ stock, productBase, lists, access, clock, logger = console }: StockApiDeps): Hono {
  const api = new Hono();

  /** Qui écrit : téléphone appairé ou tablette (personne reconnue s'il y en a une) ; sinon la réponse d'erreur. */
  async function writer(c: Context): Promise<{ author: Author } | { error: Response }> {
    const who = await access.caller(c);
    if (who.rejectedToken) return { error: c.json({ error: 'Téléphone non reconnu : à appairer de nouveau' }, 401) };
    if (who.device) return { author: { ownerId: who.device.ownerId, via: 'phone' } };
    if (who.kiosk) return { author: { ownerId: who.actorId ?? null, via: 'tablet' } };
    return { error: c.json({ error: 'Lecture seule : appareil non appairé' }, 403) };
  }

  const invalid = (c: Context, error: z.ZodError) => c.json({ error: error.issues[0]?.message ?? 'Format inattendu' }, 400);

  /** La base, ramenée à une fiche ; `null` : absent de la base ; lève une erreur si la base ne répond pas. */
  async function readBase(productCode: string) {
    if (!productBase) return null;
    const found = await productBase.find(productCode);
    if (!found) return null;
    const { name, brand = null, quantity = null } = found.info;
    return { info: { name, brand, quantity, category: null }, image: found.image, base: found.base };
  }

  /** Produit épuisé : ajouté d'office à la liste de courses, ou proposé. Déjà sur la liste : rien à faire. */
  async function shoppingFor(productCode: string | null, exhausted: boolean, autoShop: boolean, movementId: string, by: Author) {
    const product = productCode ? await stock.product(productCode) : null;
    if (!product || !exhausted) return { shopping: 'none' as ShoppingOutcome, shoppingLabel: product ? shoppingLabel(product) : null };
    const label = shoppingLabel(product);
    const already = (await lists.lists()).shopping.some((s) => !s.done && s.label.toLowerCase() === label.toLowerCase());
    if (already) return { shopping: 'none' as ShoppingOutcome, shoppingLabel: label };
    if (!autoShop) return { shopping: 'propose' as ShoppingOutcome, shoppingLabel: label };
    const item = await lists.addShopping(label, by);
    await stock.attachShopping(movementId, item.id);
    return { shopping: 'added' as ShoppingOutcome, shoppingLabel: label };
  }

  api.get('/stock', async (c) => c.json(await stock.data()));

  /** Ce qu'est un code scanné : contenant de la maison, produit connu (copie locale, relue dans la base si ancienne), ou inconnu. */
  api.get('/stock/scan/:code', async (c) => {
    const scanned = c.req.param('code');
    if (!isStockCode(scanned)) return c.json({ error: 'Code-barres sur 13 chiffres attendu' }, 400);
    if (isContainerCode(scanned)) {
      const container = await stock.container(scanned);
      return container
        ? c.json<ScanLookup>({ kind: 'container', code: scanned, container })
        : c.json({ error: 'Étiquette de contenant inconnue (retiré ?)' }, 404);
    }
    let product = await stock.product(scanned);
    if (needsBaseRead(product, clock()) && productBase) {
      try {
        const reading = await readBase(scanned);
        if (reading?.info.name) product = await stock.saveFromBase(scanned, reading);
        else if (!product) {
          return c.json<ScanLookup>({ kind: 'unknown', code: scanned, suggestion: reading ? { brand: reading.info.brand, quantity: reading.info.quantity } : null, baseError: false });
        }
      } catch (err) {
        logger.error(`Base de produits (${scanned}) : ${(err as Error).message}`);
        if (!product) return c.json<ScanLookup>({ kind: 'unknown', code: scanned, suggestion: null, baseError: true });
      }
    }
    if (!product) return c.json<ScanLookup>({ kind: 'unknown', code: scanned, suggestion: null, baseError: false });
    return c.json<ScanLookup>({ kind: 'product', code: scanned, product, quantity: await stock.quantity(scanned) });
  });

  /** Produit inconnu saisi, ou « Corriger » : notre version l'emporte sur la base. */
  api.put('/stock/products/:code', async (c) => {
    const productCode = c.req.param('code');
    if (!isStockCode(productCode) || isContainerCode(productCode)) return c.json({ error: 'Code-barres de produit attendu' }, 400);
    const input = infoSchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    return c.json(await stock.saveManual(productCode, input.data));
  });

  /** « Revérifier » : relecture immédiate de la base, sans rien changer. */
  api.post('/stock/products/:code/recheck', async (c) => {
    const product = await stock.product(c.req.param('code'));
    if (!product) return c.json({ error: 'Produit inconnu' }, 404);
    const { name, brand, quantity, category } = product.current;
    const current = { name, brand, quantity, category };
    try {
      const reading = await readBase(product.code);
      const base = reading?.info.name ? { ...reading.info, category } : null;
      return c.json<ProductRecheck>({ current, base, differs: base !== null && !sameInfo(current, base), baseError: false });
    } catch (err) {
      logger.error(`Base de produits (${product.code}) : ${(err as Error).message}`);
      return c.json<ProductRecheck>({ current, base: null, differs: false, baseError: true });
    }
  });

  /** Accepter ce que dit la base (après « Revérifier ») : nouvelle version, même par-dessus notre correction. */
  api.post('/stock/products/:code/accept-base', async (c) => {
    const productCode = c.req.param('code');
    if (!(await stock.product(productCode))) return c.json({ error: 'Produit inconnu' }, 404);
    const who = await writer(c);
    if ('error' in who) return who.error;
    let reading;
    try {
      reading = await readBase(productCode);
    } catch {
      return c.json({ error: 'Base de produits injoignable' }, 503);
    }
    if (!reading?.info.name) return c.json({ error: 'Produit absent de la base' }, 404);
    const product = await stock.saveFromBase(productCode, reading);
    return c.json(product.conflict ? await stock.resolveConflict(productCode, 'base') : product);
  });

  /** La base contredit notre correction : garder la nôtre ou prendre la sienne. */
  api.post('/stock/products/:code/conflict', async (c) => {
    const input = conflictSchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    const product = await stock.resolveConflict(c.req.param('code'), input.data.take);
    return product ? c.json(product) : c.json({ error: 'Produit inconnu' }, 404);
  });

  /** Réglages d'un produit : liste de courses d'office, contenant habituel. */
  api.patch('/stock/products/:code', async (c) => {
    const input = prefsSchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    const product = await stock.setPreferences(c.req.param('code'), input.data);
    return product ? c.json(product) : c.json({ error: 'Produit inconnu' }, 404);
  });

  api.post('/stock/in', async (c) => {
    const input = inSchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    const product = await stock.product(input.data.code);
    if (!product) return c.json({ error: 'Produit inconnu : à saisir d’abord' }, 404);
    const { movementId, quantity } = await stock.add(product.code, input.data.count, input.data.price ?? null, who.author);
    return c.json<StockMovementResult>(
      { movementId, product, quantity, container: null, forgotten: false, shopping: 'none', shoppingLabel: null },
      201,
    );
  });

  api.post('/stock/out', async (c) => {
    const input = outSchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    const product = await stock.product(input.data.code);
    if (!product) return c.json({ error: 'Produit inconnu : à saisir d’abord' }, 404);
    const { all, refill, remaining } = input.data;
    if (refill && !(await stock.data()).containers.some((ct) => ct.id === refill)) return c.json({ error: 'Contenant inconnu' }, 400);
    const result = await stock.remove(product.code, { all, refill: refill ?? null, remaining }, who.author);
    const shopping = await shoppingFor(product.code, result.exhausted, result.autoShop, result.movementId, who.author);
    return c.json<StockMovementResult>({
      movementId: result.movementId,
      product: await stock.product(product.code),
      quantity: result.quantity,
      container: result.container,
      forgotten: result.forgotten,
      ...shopping,
    });
  });

  /** Inventaire : la quantité comptée à la main. */
  api.post('/stock/quantity', async (c) => {
    const input = quantitySchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    const product = await stock.product(input.data.code);
    if (!product) return c.json({ error: 'Produit inconnu' }, 404);
    const { movementId, quantity } = await stock.setQuantity(product.code, input.data.quantity, who.author);
    return c.json<StockMovementResult>({ movementId, product, quantity, container: null, forgotten: false, shopping: 'none', shoppingLabel: null });
  });

  /** Annuler (scan en double, mauvais mode) : le dernier mouvement du produit seulement. */
  api.post('/stock/undo', async (c) => {
    const input = undoSchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    const result = await stock.undo(input.data.movementId);
    if (!result.ok) return c.json({ error: result.code ? 'Un mouvement plus récent existe pour ce produit' : 'Mouvement inconnu ou déjà annulé' }, 409);
    // L'article ajouté d'office à la liste de courses part avec, s'il n'a pas encore été acheté.
    if (result.shoppingId) {
      const item = (await lists.lists()).shopping.find((s) => s.id === result.shoppingId);
      if (item && !item.done) await lists.removeShopping(item.id);
    }
    return c.json({ quantity: result.code ? await stock.quantity(result.code) : 0 });
  });

  /** « Oui » à la proposition : sur la liste de courses ; `always` : d'office la prochaine fois. */
  api.post('/stock/shopping', async (c) => {
    const input = shopSchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    const product = await stock.product(input.data.code);
    if (!product) return c.json({ error: 'Produit inconnu' }, 404);
    if (input.data.always) await stock.setPreferences(product.code, { autoShop: true });
    return c.json(await lists.addShopping(shoppingLabel(product), who.author), 201);
  });

  api.post('/stock/containers', async (c) => {
    const input = containerSchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    return c.json(await stock.addContainer(input.data.name), 201);
  });

  api.patch('/stock/containers/:id', async (c) => {
    const input = containerSchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    const container = await stock.renameContainer(c.req.param('id'), input.data.name);
    return container ? c.json(container) : c.json({ error: 'Contenant inconnu' }, 404);
  });

  api.delete('/stock/containers/:id', async (c) => {
    const who = await writer(c);
    if ('error' in who) return who.error;
    return (await stock.removeContainer(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'Contenant inconnu' }, 404);
  });

  /** Contenant vide (déclaré à la main, ou étiquette scannée) : même proposition de liste de courses. */
  api.post('/stock/containers/:id/empty', async (c) => {
    const who = await writer(c);
    if ('error' in who) return who.error;
    const result = await stock.emptyContainer(c.req.param('id'), who.author);
    if (!result) return c.json({ error: 'Contenant inconnu' }, 404);
    const shopping = await shoppingFor(result.productCode, result.exhausted, result.autoShop, result.movementId, who.author);
    return c.json<StockMovementResult>({
      movementId: result.movementId,
      product: result.productCode ? await stock.product(result.productCode) : null,
      quantity: result.productCode ? await stock.quantity(result.productCode) : 0,
      container: result.container,
      forgotten: false,
      ...shopping,
    });
  });

  api.put('/stock/settings', async (c) => {
    const input = settingsSchema.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    const who = await writer(c);
    if ('error' in who) return who.error;
    return c.json(await stock.saveSettings(input.data));
  });

  return api;
}
