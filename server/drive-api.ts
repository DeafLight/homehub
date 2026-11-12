// Routes du drive : l'enseigne et le magasin de retrait, le produit retenu pour chaque article de la liste de courses
// (étape 1), les pièces par paquet et le panier en cours, coché pendant qu'on le remplit dans l'appli (étape 2). Lecture ouverte comme la liste (rien de personnel). Régler l'enseigne et le magasin : un parent.
// Lire une fiche et retenir un produit : qui peut modifier la liste de courses (droit sur la famille : un parent),
// vérifié avant toute lecture sur le réseau. La fiche n'est lue que sur demande, une fois, et seulement si c'est une
// fiche produit d'une enseigne connue ; un refus du site n'est jamais contourné : la personne saisit le nom et la
// contenance, ou les reprend d'un produit du stock (par EAN). Cocher le panier et dire les pièces d'un paquet : même
// droit que la liste de courses. Le serveur calcule lui-même ce qui part au panier (produit retenu, paquets) d'après
// l'article de la liste : rien n'est repris du front.
import { z } from 'zod';
import {
  basketLine,
  choiceFor,
  DRIVE_LIMITS,
  type DriveBasket,
  type DriveProduct,
  type DriveReadResult,
  type DriveStockHint,
  type DriveView,
  ENSEIGNES,
  type Enseigne,
  enseigneName,
  itemKey,
  normalizeEan,
  productLink,
  storeLink,
} from '../shared/drive.ts';
import { ingredientKey, parseIngredient } from '../shared/ingredients.ts';
import { parsePackage } from '../shared/quantities.ts';
import { FAMILY_ID } from '../shared/types.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import type { ListsStore } from './sources/lists.ts';
import type { DriveReader } from './sources/drive-page.ts';
import type { DriveStore } from './sources/drive.ts';
import type { MenuStore } from './sources/menus.ts';
import type { StockStore } from './sources/stock.ts';
import type { Clock } from './sources/types.ts';
import { PageError } from './sources/web-page.ts';

export type DriveApiDeps = {
  drive: DriveStore;
  /** Lecture des fiches ; absente (tests sans réseau) : nom et contenance se saisissent. */
  reader?: DriveReader;
  stock: StockStore;
  menus: MenuStore;
  /** Liste de courses : les articles mis au panier en viennent. */
  lists: ListsStore;
  access: Access;
  clock: Clock;
};

export const DRIVE_PARENTS_ONLY = 'Seul un parent peut régler le drive';
export const REFUSED_PRODUCT = 'Le site refuse la lecture par HomeHub : saisis le nom et la contenance du paquet, ou reprends-les d’un produit du stock';
export const NO_ENSEIGNE = 'Choisis d’abord une enseigne dans les réglages du drive';

const key = z.string().trim().min(1).max(120);
const settingsSchema = z.object({
  enseigne: z.enum(ENSEIGNES).nullable(),
  store: z.object({ name: z.string().trim().max(DRIVE_LIMITS.storeName), url: z.string().trim().max(2000).nullable().default(null) }).nullable().default(null),
});
const readSchema = z.object({ url: z.string().trim().min(1).max(2000) });
const chooseSchema = z.object({
  key,
  label: z.string().trim().min(1).max(DRIVE_LIMITS.name),
  role: z.enum(['preferred', 'fallback']).default('preferred'),
  product: z.object({
    url: z.string().trim().min(1).max(2000),
    name: z.string().trim().min(1, 'Nom du produit attendu').max(DRIVE_LIMITS.name),
    brand: z.string().trim().max(DRIVE_LIMITS.brand).nullish(),
    packText: z.string().trim().max(DRIVE_LIMITS.pack).nullish(),
    ean: z.string().trim().max(14).nullish(),
    source: z.enum(['page', 'manual', 'stock']).default('manual'),
    pieces: z.number().int().min(1).max(DRIVE_LIMITS.pieces).nullish(),
  }),
});
const piecesSchema = z.object({ key, id: z.string().trim().min(1).max(80), pieces: z.number().int().min(1, 'Au moins une pièce').max(DRIVE_LIMITS.pieces).nullable() });
const basketSchema = z.object({ in: z.boolean() });

/** Clé d'un nom de produit du stock, comparable à celle d'un article (« Lessive liquide » → « lessive-liquide »). */
const nameKey = (name: string) => ingredientKey(parseIngredient(name).name);

export function createDriveApi({ drive, reader, stock, menus, lists, access, clock }: DriveApiDeps) {
  const api = createRouter();

  const shopping = async () => (await lists.lists()).shopping;
  /** Panier tel qu'on le montre : seulement les lignes dont l'article est encore dans la liste. */
  const visibleBasket = (basket: DriveBasket | null, ids: ReadonlySet<string>): DriveBasket | null =>
    basket && { ...basket, lines: basket.lines.filter((l) => ids.has(l.itemId)) };
  const view = async (): Promise<DriveView> => ({
    settings: await drive.settings(),
    choices: await drive.choices(),
    basket: visibleBasket(await drive.basket(), new Set((await shopping()).map((i) => i.id))),
  });
  const enseigne = async (): Promise<Enseigne> => (await drive.settings()).enseigne ?? fail(400, NO_ENSEIGNE);
  const hint = (code: string, info: { name: string; brand: string | null; quantity: string | null }): DriveStockHint => ({ ean: code, name: info.name, brand: info.brand, quantity: info.quantity });

  api.get('/drive', async (c) => c.json(await view()));

  api.put('/drive/settings', async (c) => {
    const input = await readBody(c, settingsSchema, z.prettifyError);
    await access.parent(c, DRIVE_PARENTS_ONLY);
    let store = input.store && input.store.name ? { name: input.store.name, url: null as string | null } : null;
    if (input.store?.url) {
      if (!input.enseigne) return fail(400, NO_ENSEIGNE);
      const url = storeLink(input.store.url, input.enseigne) ?? fail(400, `Lien du magasin attendu sur le site ${enseigneName(input.enseigne)}`);
      store = { name: input.store.name || 'Magasin', url };
    }
    await drive.setSettings({ enseigne: input.enseigne, store });
    return c.json(await view());
  });

  /** Produits du stock qui ressemblent à un article : reliés à sa clé dans le menu, ou de même nom. */
  api.get('/drive/stock', async (c) => {
    const wanted = key.safeParse(c.req.query('key')).data ?? fail(400, 'Article attendu (?key=…)');
    const { links } = await menus.data();
    const hints: DriveStockHint[] = [];
    for (const { product } of (await stock.data()).items) {
      const linked = links[product.code]?.key === wanted;
      const words = nameKey(product.current.name);
      if (linked || words === wanted || words.split(/[- ]/u)[0] === wanted) hints.push(hint(product.code, product.current));
    }
    return c.json({ hints: hints.slice(0, 10) });
  });

  /** Lecture d'une fiche partagée, une fois, à la demande : rien n'est retenu ici. */
  api.post('/drive/read', async (c) => {
    const input = await readBody(c, readSchema, 'Corps attendu : { "url": "https://…" }');
    await access.writer(c, FAMILY_ID);
    const chosen = await enseigne();
    const link = productLink(input.url) ?? fail(400, `Lien d’une fiche produit ${enseigneName(chosen)} attendu (…/p/…/….html)`);
    if (link.enseigne !== chosen) return fail(400, `Ce produit n’est pas chez ${enseigneName(chosen)}`);
    const bare = { ...link, name: '', brand: null, packText: null, ean: null };
    const respond = async (result: DriveReadResult) => {
      const known = result.product.ean ? await stock.product(result.product.ean) : null;
      return c.json({ ...result, stock: known ? hint(known.code, known.current) : null });
    };
    if (!reader) return respond({ read: false, product: bare, reason: 'Lecture des pages indisponible' });
    try {
      const read = await reader.read(link.url);
      if (!read.found) return respond({ read: false, product: read.product, reason: 'Aucune fiche produit lisible sur cette page' });
      return respond({ read: true, product: read.product });
    } catch (err) {
      if (!(err instanceof PageError)) throw err;
      if (err.kind === 'refused') return respond({ read: false, product: bare, reason: REFUSED_PRODUCT, refused: true });
      return respond({ read: false, product: bare, reason: err.message });
    }
  });

  /** Retenir un produit pour un article (ou l'ajouter en secours). */
  api.put('/drive/choices', async (c) => {
    const input = await readBody(c, chooseSchema, z.prettifyError);
    const author = await access.writer(c, FAMILY_ID);
    const chosen = await enseigne();
    const link = productLink(input.product.url) ?? fail(400, 'Lien d’une fiche produit attendu');
    if (link.enseigne !== chosen) return fail(400, `Ce produit n’est pas chez ${enseigneName(chosen)}`);
    const ean = input.product.ean ? (normalizeEan(input.product.ean) ?? fail(400, 'EAN illisible (8 à 13 chiffres)')) : null;
    const packText = input.product.packText || null;
    const product: DriveProduct = {
      ...link,
      name: input.product.name,
      brand: input.product.brand || null,
      packText,
      pack: parsePackage(packText),
      ean,
      source: input.product.source,
      seenAt: clock().toISOString(),
      pieces: input.product.pieces ?? null,
    };
    const choice = (await drive.choose({ key: input.key, label: input.label, product, role: input.role }, author)) ?? fail(409, 'Trop de produits retenus');
    return c.json(choice);
  });

  /** Retirer un produit d'un choix (`id`), ou tout le choix. Le produit retenu retiré n'est remplacé par aucun secours. */
  api.delete('/drive/choices', async (c) => {
    const wanted = key.safeParse(c.req.query('key')).data ?? fail(400, 'Article attendu (?key=…)');
    const author = await access.writer(c, FAMILY_ID);
    const removed = await drive.forget(wanted, await enseigne(), c.req.query('id') ?? null, author);
    return removed ? c.body(null, 204) : fail(404, 'Rien à retirer');
  });

  /** Pièces dans un paquet (« 2 oignons » contre un filet de 1 kg), retenues sur le produit ; null : oublier. */
  api.put('/drive/pieces', async (c) => {
    const input = await readBody(c, piecesSchema, z.prettifyError);
    const author = await access.writer(c, FAMILY_ID);
    const choice = (await drive.setPieces(input.key, await enseigne(), input.id, input.pieces, author)) ?? fail(404, 'Produit introuvable pour cet article');
    return c.json(choice);
  });

  /**
   * Cocher (`in: true`) ou décocher un article dans le panier en cours. Le produit et les paquets viennent du produit
   * retenu pour l'article ; un article sans produit retenu peut être coché aussi (trouvé dans l'appli), 1 paquet.
   */
  api.put('/drive/basket/:itemId', async (c) => {
    const input = await readBody(c, basketSchema, 'Corps attendu : { "in": true }');
    const author = await access.writer(c, FAMILY_ID);
    const chosen = await enseigne();
    const items = await shopping();
    const ids = new Set(items.map((i) => i.id));
    const item = items.find((i) => i.id === c.req.param('itemId')) ?? fail(404, 'Article introuvable dans la liste de courses');
    if (input.in) {
      if (item.done) return fail(409, 'Article déjà acheté');
      const line = basketLine(item, choiceFor(await drive.choices(), itemKey(item), chosen));
      (await drive.putInBasket(chosen, line, ids, author)) ?? fail(409, 'Panier plein');
    } else {
      await drive.takeOutOfBasket(item.id, ids);
    }
    return c.json(await view());
  });

  /** Nouveau panier : plus aucun article marqué « au drive ». */
  api.delete('/drive/basket', async (c) => {
    await access.writer(c, FAMILY_ID);
    await drive.clearBasket();
    return c.json(await view());
  });

  return api;
}
