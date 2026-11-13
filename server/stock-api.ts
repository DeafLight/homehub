// Routes du stock de la maison. Lecture ouverte comme le reste de l'API, sauf ce qui interroge la base de produits
// (appel sortant, et copie locale enregistrée). Écriture et base : la tablette ou un téléphone appairé, sans exiger
// qu'une personne soit reconnue : pendant un scan la caméra lit les codes-barres, pas les visages. Un produit sans
// code-barres (vrac, marché, fait maison) s'ajoute par son nom et sa quantité, puis passe par les mêmes routes.
// Le mouvement garde qui l'a fait quand on le sait (personne reconnue juste avant, ou profil du téléphone). Les règles
// (base de produits, liste de courses) sont dans services/stock.ts ; ici, validation, droits et réponses.
// Dates de péremption : date facultative à l'entrée, date d'un lot après coup (mêmes droits que le stock), résumé
// sans auteur pour l'accueil ; seuils et durées par rayon réglés par un parent.
import { z } from 'zod';
import { isContainerCode, isLooseCode, isStockCode } from '../shared/barcode.ts';
import { EXPIRY_LIMITS, isDay } from '../shared/expiry.ts';
import { LOOSE_UNITS, validLooseAmount } from '../shared/loose.ts';
import type { ExpiringSummary, ScanLookup, StockMovement, StockMovementResult } from '../shared/types.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { createStockService, isRefusal, type StockRefusal } from './services/stock.ts';
import type { ListsStore } from './sources/lists.ts';
import type { ProductBase } from './sources/open-food-facts.ts';
import { FIELD_MAX, NAME_MAX, type StockStore } from './sources/stock.ts';
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
const day = z.string().refine(isDay, 'date AAAA-MM-JJ attendue');
const dateKind = z.enum(['dlc', 'ddm']);
const inSchema = z.object({
  code,
  count: z.number().int().min(1).max(99).default(1),
  price: z.number().min(0).max(10_000).nullish(),
  date: day.nullish(),
  kind: dateKind.nullish(),
});
const outSchema = z.object({
  code,
  all: z.boolean().default(false),
  refill: z.string().nullish(),
  remaining: z.number().int().min(0).max(99).default(0),
  lotId: z.string().min(1).nullish(),
});
const lotSchema = z.object({
  date: day.nullable().optional(),
  kind: dateKind.nullable().optional(),
  dismissed: z.boolean().optional(),
  split: z.object({ count: z.number().int().min(1).max(99), date: day.nullable() }).optional(),
});
const threshold = z.number().int().min(0).max(EXPIRY_LIMITS.threshold);
const expirySchema = z.object({
  soonDlcDays: threshold,
  urgentDlcDays: threshold,
  soonDdmDays: z.number().int().min(0).max(EXPIRY_LIMITS.keep),
  defaults: z.record(z.string().trim().min(1).max(FIELD_MAX), z.number().int().min(1).max(EXPIRY_LIMITS.keep)).refine((d) => Object.keys(d).length <= 40, 'trop de rayons'),
});
const undoSchema = z.object({ movementId: z.string().min(1) });
const shopSchema = z.object({ code, always: z.boolean().default(false) });
const prefsSchema = z.object({
  autoShop: z.boolean().nullable().optional(),
  refill: z.string().nullable().optional(),
  dateKind: dateKind.nullable().optional(),
  askDate: z.boolean().nullable().optional(),
  keepDays: z.number().int().min(1).max(EXPIRY_LIMITS.keep).nullable().optional(),
});
const conflictSchema = z.object({ take: z.enum(['mine', 'base']) });
const containerSchema = z.object({ name: z.string().trim().min(1).max(FIELD_MAX) });
const settingsSchema = z.object({ autoShop: z.boolean() });
const looseAmount = { amount: z.number(), unit: z.enum(LOOSE_UNITS) };
const validAmount = ({ amount, unit }: { amount: number; unit: (typeof LOOSE_UNITS)[number] }) => validLooseAmount(amount, unit);
const AMOUNT_EXPECTED = 'quantité positive attendue, entière (99 au plus) pour ce qui se compte';
const looseAmountSchema = z.object(looseAmount).refine(validAmount, AMOUNT_EXPECTED);
const looseSchema = z.object({ name: z.string().trim().min(1).max(NAME_MAX), category: optionalField, ...looseAmount }).refine(validAmount, AMOUNT_EXPECTED);

const UNKNOWN_TO_ENTER = 'Produit inconnu : à saisir d’abord';
const BARCODE_EXPECTED = 'Code-barres sur 13 chiffres attendu';

type Refusals = Partial<Record<StockRefusal['refused'], [404 | 400 | 409 | 503, string]>>;

/** Le résultat du service, ou le refus correspondant (statut et message propres à chaque route). */
function orRefuse<T>(result: T | StockRefusal, refusals: Refusals): T {
  if (!isRefusal(result)) return result;
  const [status, message] = refusals[result.refused] ?? [400, 'Requête refusée'];
  return fail(status, message);
}

export function createStockApi({ stock, productBase, lists, access, clock, logger = console }: StockApiDeps) {
  const api = createRouter();
  const service = createStockService({ stock, productBase, lists, clock, logger });
  const productCode = (value: string) => (isStockCode(value) ? value : fail(400, BARCODE_EXPECTED));
  const knownProduct = async (value: string) => (await stock.product(value)) ?? fail(404, 'Produit inconnu');

  api.get('/stock', async (c) => c.json(await stock.data()));

  /** DLC passées ou urgentes (accueil, dashboard d'un parent), produits jetés périmés ce mois-ci : sans auteur. */
  api.get('/stock/expiring', async (c) => c.json<ExpiringSummary>(await stock.expiring()));

  /** Ce qu'est un code scanné : contenant de la maison, produit connu (copie locale, relue dans la base si ancienne), ou inconnu. */
  api.get('/stock/scan/:code', async (c) => {
    const value = productCode(c.req.param('code'));
    await access.appliance(c); // peut appeler la base et enregistrer sa réponse
    const lookup = await service.scan(value);
    return c.json<ScanLookup>(lookup ?? fail(404, 'Étiquette de contenant inconnue (retiré ?)'));
  });

  /** Historique d'un produit : chaque entrée et sortie, quand et par qui. */
  api.get('/stock/products/:code/movements', async (c) => c.json<StockMovement[]>(await stock.movements(productCode(c.req.param('code')))));

  /** Produit inconnu saisi, ou « Corriger » : notre version l'emporte sur la base. */
  api.put('/stock/products/:code', async (c) => {
    const value = c.req.param('code');
    if (!isStockCode(value) || isContainerCode(value)) return fail(400, 'Code-barres de produit attendu');
    const info = await readBody(c, infoSchema);
    await access.appliance(c);
    // Un identifiant interne ne se fabrique pas : seul POST /stock/loose en attribue un.
    if (isLooseCode(value) && !(await stock.product(value))) return fail(404, 'Produit inconnu');
    return c.json(await stock.saveManual(value, info));
  });

  /** Produit sans code-barres : nom, rayon, quantité avec unité ; entré au stock aussitôt. */
  api.post('/stock/loose', async (c) => {
    const input = await readBody(c, looseSchema);
    const author = await access.appliance(c);
    return c.json<StockMovementResult>(await service.addLoose(input, author), 201);
  });

  /** Nouvelle quantité d'un produit sans code-barres (« il reste 800 g ») ; pour l'épuiser : la sortie « tout ». */
  api.put('/stock/loose/:code', async (c) => {
    const { amount, unit } = await readBody(c, looseAmountSchema);
    const author = await access.appliance(c);
    const result = await service.setLoose(c.req.param('code'), amount, unit, author);
    return c.json<StockMovementResult>(orRefuse(result, { 'unknown-product': [404, 'Produit sans code-barres inconnu'] }));
  });

  /** « Revérifier » : relecture immédiate de la base, sans rien changer. */
  api.post('/stock/products/:code/recheck', async (c) => {
    await access.appliance(c); // appel sortant vers la base
    return c.json((await service.recheck(c.req.param('code'))) ?? fail(404, 'Produit inconnu'));
  });

  /** Accepter ce que dit la base (après « Revérifier ») : nouvelle version, même par-dessus notre correction. */
  api.post('/stock/products/:code/accept-base', async (c) => {
    const product = await knownProduct(c.req.param('code'));
    await access.appliance(c);
    const accepted = await service.acceptBase(product.code);
    return c.json(orRefuse(accepted, { 'base-unreachable': [503, 'Base de produits injoignable'], 'not-in-base': [404, 'Produit absent de la base'] }));
  });

  /** La base contredit notre correction : garder la nôtre ou prendre la sienne. */
  api.post('/stock/products/:code/conflict', async (c) => {
    const { take } = await readBody(c, conflictSchema);
    await access.appliance(c);
    return c.json((await stock.resolveConflict(c.req.param('code'), take)) ?? fail(404, 'Produit inconnu'));
  });

  /** Réglages d'un produit : liste de courses d'office, contenant habituel. */
  api.patch('/stock/products/:code', async (c) => {
    const prefs = await readBody(c, prefsSchema);
    await access.appliance(c);
    return c.json((await stock.setPreferences(c.req.param('code'), prefs)) ?? fail(404, 'Produit inconnu'));
  });

  api.post('/stock/in', async (c) => {
    const input = await readBody(c, inSchema);
    const author = await access.appliance(c);
    const result = await service.stockIn(input.code, input.count, input.price ?? null, author, { date: input.date ?? null, kind: input.kind ?? null });
    return c.json<StockMovementResult>(orRefuse(result, { 'unknown-product': [404, UNKNOWN_TO_ENTER] }), 201);
  });

  api.post('/stock/out', async (c) => {
    const { code: value, all, refill, remaining, lotId } = await readBody(c, outSchema);
    const author = await access.appliance(c);
    const result = await service.stockOut(value, { all, refill: refill ?? null, remaining, lotId: lotId ?? null }, author);
    return c.json<StockMovementResult>(orRefuse(result, { 'unknown-product': [404, UNKNOWN_TO_ENTER], 'unknown-container': [400, 'Contenant inconnu'] }));
  });

  /** Date d'un lot (« Date ? » au scanner, ou après coup), type DLC / DDM, « Encore bon », partie à une autre date. */
  api.put('/stock/lots/:id', async (c) => {
    const change = await readBody(c, lotSchema);
    const author = await access.appliance(c);
    return c.json(orRefuse(await service.setLot(c.req.param('id'), change, author), { 'unknown-lot': [404, 'Lot inconnu (sorti entre-temps ?)'] }));
  });

  /** Annuler (scan en double, mauvais mode) : le dernier mouvement du produit seulement. */
  api.post('/stock/undo', async (c) => {
    const { movementId } = await readBody(c, undoSchema);
    await access.appliance(c);
    const result = await service.undo(movementId);
    return c.json(
      orRefuse(result, {
        'newer-movement': [409, 'Un mouvement plus récent existe pour ce produit'],
        'no-movement': [409, 'Mouvement inconnu ou déjà annulé'],
      }),
    );
  });

  /** « Oui » à la proposition : sur la liste de courses ; `always` : d'office la prochaine fois. */
  api.post('/stock/shopping', async (c) => {
    const input = await readBody(c, shopSchema);
    const author = await access.appliance(c);
    return c.json(orRefuse(await service.shop(input.code, input.always, author), { 'unknown-product': [404, 'Produit inconnu'] }), 201);
  });

  api.post('/stock/containers', async (c) => {
    const { name } = await readBody(c, containerSchema);
    await access.appliance(c);
    return c.json(await stock.addContainer(name), 201);
  });

  api.patch('/stock/containers/:id', async (c) => {
    const { name } = await readBody(c, containerSchema);
    await access.appliance(c);
    return c.json((await stock.renameContainer(c.req.param('id'), name)) ?? fail(404, 'Contenant inconnu'));
  });

  api.delete('/stock/containers/:id', async (c) => {
    await access.appliance(c);
    return (await stock.removeContainer(c.req.param('id'))) ? c.body(null, 204) : fail(404, 'Contenant inconnu');
  });

  /** Contenant vide (déclaré à la main, ou étiquette scannée) : même proposition de liste de courses. */
  api.post('/stock/containers/:id/empty', async (c) => {
    const author = await access.appliance(c);
    const result = await service.emptyContainer(c.req.param('id'), author);
    return c.json<StockMovementResult>(orRefuse(result, { 'unknown-container': [404, 'Contenant inconnu'] }));
  });

  api.put('/stock/settings', async (c) => {
    const { autoShop } = await readBody(c, settingsSchema);
    await access.appliance(c);
    return c.json(await stock.saveSettings({ autoShop }));
  });

  /** Seuils et durées par rayon des dates de péremption : un parent. */
  api.put('/stock/settings/expiry', async (c) => {
    const expiry = await readBody(c, expirySchema);
    await access.parent(c, 'Réglage réservé aux parents');
    return c.json(await stock.saveSettings({ expiry }));
  });

  return api;
}
