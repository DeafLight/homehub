// Routes du drive (étape 1) : l'enseigne et le magasin de retrait, et le produit retenu pour chaque article de la
// liste de courses. Lecture ouverte comme la liste (rien de personnel). Régler l'enseigne et le magasin : un parent.
// Lire une fiche et retenir un produit : qui peut modifier la liste de courses (droit sur la famille : un parent),
// vérifié avant toute lecture sur le réseau. La fiche n'est lue que sur demande, une fois, et seulement si c'est une
// fiche produit d'une enseigne connue ; un refus du site n'est jamais contourné : la personne saisit le nom et la
// contenance, ou les reprend d'un produit du stock (par EAN).
import { z } from 'zod';
import {
  DRIVE_LIMITS,
  type DriveProduct,
  type DriveReadResult,
  type DriveStockHint,
  type DriveView,
  ENSEIGNES,
  type Enseigne,
  enseigneName,
  normalizeEan,
  productLink,
  storeLink,
} from '../shared/drive.ts';
import { ingredientKey, parseIngredient } from '../shared/ingredients.ts';
import { parsePackage } from '../shared/quantities.ts';
import { FAMILY_ID } from '../shared/types.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
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
  }),
});

/** Clé d'un nom de produit du stock, comparable à celle d'un article (« Lessive liquide » → « lessive-liquide »). */
const nameKey = (name: string) => ingredientKey(parseIngredient(name).name);

export function createDriveApi({ drive, reader, stock, menus, access, clock }: DriveApiDeps) {
  const api = createRouter();

  const view = async (): Promise<DriveView> => ({ settings: await drive.settings(), choices: await drive.choices() });
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

  return api;
}
