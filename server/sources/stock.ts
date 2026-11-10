// Stock de la maison (stock.json dans le dossier d'état) : les produits connus par leur code-barres (copie de la base
// ou saisie à la main, en versions datées), ce qu'on en a, chaque entrée et sortie, et les contenants de la maison
// (bidon de lessive, bocal…) où l'on transvase les recharges. Comme les listes : une modification à la fois, écrite
// sur le disque (fichier temporaire puis renommage) avant d'être confirmée.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { containerCode } from '../../shared/barcode.ts';
import type { Author, Container, Product, ProductInfo, StockData, StockEntry, StockMark, StockMovement, StockSettings } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema } from './schemas.ts';
import type { Clock } from './types.ts';

/** Mouvements gardés (les plus récents) : de quoi annuler et, plus tard, relier les prix. */
const MOVEMENTS_KEPT = 5000;
/** Au-delà, une fiche lue dans la base est relue au scan suivant (nom et contenance changent rarement). */
export const BASE_REREAD_DAYS = 180;
export const NAME_MAX = 120;
export const FIELD_MAX = 60;

const infoSchema = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  quantity: z.string().nullable(),
  category: z.string().nullable(),
});
const versionSchema = infoSchema.extend({
  from: z.string(),
  source: z.enum(['base', 'manual']),
  base: z.string().nullable(),
});
const containerSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  productCode: z.string().nullable(),
  full: z.boolean(),
});

const fileSchema = z.object({
  version: z.literal(1),
  products: z.record(
    z.string(),
    z.object({
      versions: z.array(versionSchema).min(1),
      image: z.string().nullable(),
      autoShop: z.boolean().nullable(),
      refill: z.string().nullable(),
      conflict: infoSchema.nullable(),
      baseReadAt: z.string().nullable(),
    }),
  ),
  stock: z.record(z.string(), z.object({ quantity: z.number().int().min(0), updatedAt: z.string() })),
  movements: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      code: z.string(),
      kind: z.enum(['in', 'out', 'refill', 'adjust', 'container-empty']),
      /** Unités entrées ou sorties ; pour « adjust », la nouvelle quantité. */
      count: z.number().int(),
      /** Prix payé (unité), quand on le connaît : jamais exigé. */
      price: z.number().nullable(),
      /** Version du produit en vigueur à ce moment (rang dans `versions`). */
      productVersion: z.number().int().nullable(),
      by: authorSchema,
      /** Sortie d'un produit absent du stock : l'entrée avait été oubliée. */
      forgotten: z.boolean(),
      /** État d'avant, pour annuler. */
      before: z.object({
        quantity: z.number().int().nullable(),
        refill: z.string().nullable().optional(),
        container: containerSchema.nullable().optional(),
      }),
      /** Article ajouté d'office à la liste de courses (retiré si on annule). */
      shoppingId: z.string().nullable(),
      undone: z.boolean(),
    }),
  ),
  containers: z.array(containerSchema),
  nextContainer: z.number().int().min(1),
  settings: z.object({ autoShop: z.boolean() }),
});

type StockFile = z.infer<typeof fileSchema>;
type StoredProduct = StockFile['products'][string];
type Movement = StockFile['movements'][number];
type StoredContainer = z.infer<typeof containerSchema>;

export type BaseReading = { info: ProductInfo; image: string | null; base: string };

/** Ce qu'a donné une sortie, avant la décision sur la liste de courses (prise par l'API). */
export type OutResult = {
  movementId: string;
  /** Heure du mouvement (ISO 8601). */
  at: string;
  quantity: number;
  forgotten: boolean;
  /** Plus rien de ce produit (et pas transvasé) : la liste de courses est concernée. */
  exhausted: boolean;
  /** Ajouter d'office (réglage du produit, sinon celui du stock). */
  autoShop: boolean;
  container: Container | null;
};

export type StockStore = {
  data(): Promise<StockData>;
  product(code: string): Promise<Product | null>;
  quantity(code: string): Promise<number>;
  container(code: string): Promise<Container | null>;
  /** Fiche lue dans la base : nouvelle, relue (nouvelle version si elle a changé), ou conflit avec notre correction. */
  saveFromBase(code: string, reading: BaseReading): Promise<Product>;
  /** « Corriger », ou produit inconnu saisi : notre version, qui l'emporte sur la base. */
  saveManual(code: string, info: ProductInfo): Promise<Product>;
  /** Conflit avec la base : garder notre version, ou passer à celle de la base. */
  resolveConflict(code: string, take: 'mine' | 'base'): Promise<Product | null>;
  setPreferences(code: string, prefs: { autoShop?: boolean | null; refill?: string | null }): Promise<Product | null>;
  /** Entrée de `count` unités (prix facultatif). */
  add(code: string, count: number, price: number | null, by: Author): Promise<{ movementId: string; at: string; quantity: number }>;
  /**
   * Sortie d'une unité (ou de tout) ; `refill` : l'emballage part mais le produit reste, transvasé dans ce contenant.
   * Produit absent du stock : acceptée (entrée oubliée), et `remaining` unités restent en stock.
   */
  remove(code: string, options: { all?: boolean; refill?: string | null; remaining?: number }, by: Author): Promise<OutResult>;
  /** Quantité fixée à la main (inventaire). */
  setQuantity(code: string, quantity: number, by: Author): Promise<{ movementId: string; at: string; quantity: number }>;
  /** Mouvements d'un produit (ou d'un contenant, par son étiquette), du plus récent au plus ancien. */
  movements(code: string, limit?: number): Promise<StockMovement[]>;
  /** Annule un mouvement, s'il est le dernier de son produit (ou de son contenant). Renvoie l'article de courses à retirer. */
  undo(movementId: string): Promise<{ ok: boolean; shoppingId: string | null; code: string | null }>;
  attachShopping(movementId: string, shoppingId: string): Promise<void>;
  addContainer(name: string): Promise<Container>;
  renameContainer(id: string, name: string): Promise<Container | null>;
  removeContainer(id: string): Promise<boolean>;
  /** Contenant vide : le produit qu'il contenait est concerné par la liste de courses. */
  emptyContainer(id: string, by: Author): Promise<(Omit<OutResult, 'forgotten' | 'quantity'> & { productCode: string | null }) | null>;
  saveSettings(settings: StockSettings): Promise<StockSettings>;
};

/** Libellé de la liste de courses pour un produit : son nom (la marque n'y est pas, on achète ce qu'on trouve). */
export const shoppingLabel = (product: Product) => product.current.name;

const sameInfo = (a: ProductInfo, b: ProductInfo) =>
  a.name === b.name && a.brand === b.brand && a.quantity === b.quantity;

export function createStockStore({ path, clock }: { path: string; clock: Clock }): StockStore {
  // Jamais d'écrasement d'un fichier qu'on ne comprend pas : le stock reste en lecture seule (erreur 500).
  const state = createJsonFile<StockFile>({
    path,
    schema: fileSchema,
    initial: () => ({ version: 1, products: {}, stock: {}, movements: [], containers: [], nextContainer: 1, settings: { autoShop: false } }),
    beforeSave(draft) {
      if (draft.movements.length > MOVEMENTS_KEPT) draft.movements = draft.movements.slice(-MOVEMENTS_KEPT);
    },
  });

  const change = <T>(apply: (file: StockFile, now: Date) => T): Promise<T> => state.update((draft) => apply(draft, clock()));
  const read = async <T>(get: (file: StockFile) => T): Promise<T> => get(await state.read());

  function toProduct(code: string, stored: StoredProduct): Product {
    const current = stored.versions.at(-1) as StoredProduct['versions'][number];
    return {
      code,
      current,
      versionCount: stored.versions.length,
      image: stored.image,
      autoShop: stored.autoShop,
      refill: stored.refill,
      conflict: stored.conflict,
      baseReadAt: stored.baseReadAt,
    };
  }

  function toContainer(file: StockFile, c: StoredContainer): Container {
    const product = c.productCode ? file.products[c.productCode] : undefined;
    return { ...c, productName: product?.versions.at(-1)?.name ?? null };
  }

  const productOf = (file: StockFile, code: string) => {
    const stored = file.products[code];
    return stored ? toProduct(code, stored) : null;
  };

  const quantityOf = (file: StockFile, code: string) => file.stock[code]?.quantity ?? 0;

  function setStock(file: StockFile, code: string, quantity: number, now: Date) {
    file.stock[code] = { quantity: Math.max(0, quantity), updatedAt: now.toISOString() };
  }

  function record(file: StockFile, now: Date, movement: Omit<Movement, 'id' | 'at' | 'productVersion' | 'undone' | 'shoppingId' | 'forgotten'> & Partial<Pick<Movement, 'forgotten'>>) {
    const stored = file.products[movement.code];
    const full: Movement = {
      id: randomUUID(),
      at: now.toISOString(),
      productVersion: stored ? stored.versions.length - 1 : null,
      forgotten: false,
      shoppingId: null,
      undone: false,
      ...movement,
    };
    file.movements.push(full);
    return full;
  }

  const autoShopOf = (file: StockFile, code: string) => file.products[code]?.autoShop ?? file.settings.autoShop;

  /** Dernière entrée et dernière sortie de chaque produit (mouvements annulés et inventaires exceptés). */
  function lastMarks(file: StockFile) {
    const marks = new Map<string, { lastIn: StockMark | null; lastOut: StockMark | null }>();
    for (const m of file.movements) {
      if (m.undone || m.kind === 'adjust') continue;
      const entry = marks.get(m.code) ?? { lastIn: null, lastOut: null };
      const mark = { at: m.at, by: m.by };
      if (m.kind === 'in') entry.lastIn = mark;
      else entry.lastOut = mark;
      marks.set(m.code, entry);
    }
    return marks;
  }

  return {
    data: () =>
      read((file) => {
        const marks = lastMarks(file);
        const items: StockEntry[] = Object.entries(file.products).map(([code, stored]) => ({
          product: toProduct(code, stored),
          quantity: quantityOf(file, code),
          updatedAt: file.stock[code]?.updatedAt ?? null,
          lastIn: marks.get(code)?.lastIn ?? null,
          lastOut: marks.get(code)?.lastOut ?? null,
        }));
        items.sort(
          (a, b) =>
            Number(b.quantity > 0) - Number(a.quantity > 0) ||
            a.product.current.name.localeCompare(b.product.current.name, 'fr', { sensitivity: 'base' }),
        );
        return { items, containers: file.containers.map((c) => toContainer(file, c)), settings: { ...file.settings } };
      }),

    product: (code) => read((file) => productOf(file, code)),
    movements: (code, limit = 50) =>
      read((file) =>
        file.movements
          .filter((m) => m.code === code)
          .slice(-limit)
          .reverse()
          .map(({ id, at, kind, count, price, by, forgotten, undone }) => ({ id, at, kind, count, price, by: { ...by }, forgotten, undone })),
      ),
    quantity: (code) => read((file) => quantityOf(file, code)),
    container: (code) =>
      read((file) => {
        const found = file.containers.find((c) => c.code === code);
        return found ? toContainer(file, found) : null;
      }),

    saveFromBase(code, { info, image, base }) {
      return change((file, now) => {
        const stored = file.products[code];
        const version = { ...info, from: now.toISOString(), source: 'base' as const, base };
        if (!stored) {
          file.products[code] = { versions: [version], image, autoShop: null, refill: null, conflict: null, baseReadAt: now.toISOString() };
          return productOf(file, code) as Product;
        }
        stored.baseReadAt = now.toISOString();
        stored.image = image ?? stored.image;
        const current = stored.versions.at(-1) as StoredProduct['versions'][number];
        // Le rayon est le nôtre : la base n'en donne pas.
        const incoming = { ...info, category: current.category };
        if (sameInfo(current, incoming)) {
          stored.conflict = null;
        } else if (current.source === 'manual') {
          // Notre correction l'emporte : on signale seulement que la base dit autre chose.
          stored.conflict = incoming;
        } else {
          stored.versions.push({ ...version, category: current.category });
          stored.conflict = null;
        }
        return productOf(file, code) as Product;
      });
    },

    saveManual(code, info) {
      return change((file, now) => {
        const version = { ...info, from: now.toISOString(), source: 'manual' as const, base: null };
        const stored = file.products[code];
        if (!stored) {
          file.products[code] = { versions: [version], image: null, autoShop: null, refill: null, conflict: null, baseReadAt: null };
        } else {
          const current = stored.versions.at(-1) as StoredProduct['versions'][number];
          // Seul le rayon change : pas une nouvelle version du produit.
          if (sameInfo(current, info)) current.category = info.category;
          else stored.versions.push(version);
          stored.conflict = null;
        }
        return productOf(file, code) as Product;
      });
    },

    resolveConflict(code, take) {
      return change((file, now) => {
        const stored = file.products[code];
        if (!stored) return null;
        if (take === 'base' && stored.conflict) {
          stored.versions.push({ ...stored.conflict, from: now.toISOString(), source: 'base', base: stored.versions.at(-1)?.base ?? 'open-food-facts' });
        }
        stored.conflict = null;
        return productOf(file, code);
      });
    },

    setPreferences(code, prefs) {
      return change((file) => {
        const stored = file.products[code];
        if (!stored) return null;
        if (prefs.autoShop !== undefined) stored.autoShop = prefs.autoShop;
        if (prefs.refill !== undefined) stored.refill = prefs.refill;
        return productOf(file, code);
      });
    },

    add(code, count, price, by) {
      return change((file, now) => {
        const before = quantityOf(file, code);
        setStock(file, code, before + count, now);
        const movement = record(file, now, { code, kind: 'in', count, price, by, before: { quantity: before } });
        return { movementId: movement.id, at: movement.at, quantity: quantityOf(file, code) };
      });
    },

    remove(code, { all = false, refill = null, remaining = 0 }, by) {
      return change((file, now) => {
        const before = quantityOf(file, code);
        const stored = file.products[code];
        const forgotten = before === 0;
        // Entrée oubliée : la sortie passe quand même ; ce qui reste entre au stock (sans prix).
        const after = forgotten ? Math.max(0, remaining) : all ? 0 : before - 1;
        setStock(file, code, after, now);
        let container: StoredContainer | undefined;
        let containerBefore: StoredContainer | null = null;
        if (refill) {
          container = file.containers.find((c) => c.id === refill);
          if (container) {
            containerBefore = { ...container };
            Object.assign(container, { productCode: code, full: true });
          }
        }
        const movement = record(file, now, {
          code,
          kind: container ? 'refill' : 'out',
          count: forgotten ? 1 : before - after,
          price: null,
          by,
          forgotten,
          before: { quantity: before, refill: stored?.refill ?? null, container: containerBefore },
        });
        // Transvasé : on retient le contenant pour ce code-barres (proposé d'office la prochaine fois).
        if (container && stored) stored.refill = container.id;
        return {
          movementId: movement.id,
          at: movement.at,
          quantity: after,
          forgotten,
          exhausted: !container && after === 0,
          autoShop: autoShopOf(file, code),
          container: container ? toContainer(file, container) : null,
        };
      });
    },

    setQuantity(code, quantity, by) {
      return change((file, now) => {
        const before = quantityOf(file, code);
        setStock(file, code, quantity, now);
        const movement = record(file, now, { code, kind: 'adjust', count: quantity, price: null, by, before: { quantity: before } });
        return { movementId: movement.id, at: movement.at, quantity: quantityOf(file, code) };
      });
    },

    undo(movementId) {
      return change((file, now) => {
        const movement = file.movements.find((m) => m.id === movementId);
        if (!movement || movement.undone) return { ok: false, shoppingId: null, code: null };
        // Seulement le dernier mouvement de ce produit (et de ce contenant) : annuler plus ancien fausserait la suite.
        const containerId = movement.before.container?.id;
        const later = file.movements
          .slice(file.movements.indexOf(movement) + 1)
          .find((m) => !m.undone && (m.code === movement.code || (containerId !== undefined && m.before.container?.id === containerId)));
        if (later) return { ok: false, shoppingId: null, code: movement.code };
        if (movement.before.quantity !== null) setStock(file, movement.code, movement.before.quantity, now);
        const stored = file.products[movement.code];
        if (stored && movement.before.refill !== undefined) stored.refill = movement.before.refill;
        if (movement.before.container) {
          const container = file.containers.find((c) => c.id === movement.before.container?.id);
          if (container) Object.assign(container, movement.before.container);
        }
        movement.undone = true;
        return { ok: true, shoppingId: movement.shoppingId, code: movement.code };
      });
    },

    attachShopping(movementId, shoppingId) {
      return change((file) => {
        const movement = file.movements.find((m) => m.id === movementId);
        if (movement) movement.shoppingId = shoppingId;
      });
    },

    addContainer(name) {
      return change((file) => {
        const container: StoredContainer = { id: randomUUID(), code: containerCode(file.nextContainer), name, productCode: null, full: false };
        file.nextContainer += 1;
        file.containers.push(container);
        return toContainer(file, container);
      });
    },

    renameContainer(id, name) {
      return change((file) => {
        const container = file.containers.find((c) => c.id === id);
        if (!container) return null;
        container.name = name;
        return toContainer(file, container);
      });
    },

    removeContainer(id) {
      return change((file) => {
        const before = file.containers.length;
        file.containers = file.containers.filter((c) => c.id !== id);
        for (const stored of Object.values(file.products)) if (stored.refill === id) stored.refill = null;
        return file.containers.length < before;
      });
    },

    emptyContainer(id, by) {
      return change((file, now) => {
        const container = file.containers.find((c) => c.id === id);
        if (!container) return null;
        const movement = record(file, now, {
          code: container.productCode ?? container.code,
          kind: 'container-empty',
          count: 0,
          price: null,
          by,
          before: { quantity: null, container: { ...container } },
        });
        const wasFull = container.full;
        container.full = false;
        const productCode = container.productCode;
        // Plus rien dans le contenant ni en paquets : à racheter.
        const exhausted = wasFull && productCode !== null && quantityOf(file, productCode) === 0;
        return {
          movementId: movement.id,
          at: movement.at,
          productCode,
          exhausted,
          autoShop: productCode ? autoShopOf(file, productCode) : false,
          container: toContainer(file, container),
        };
      });
    },

    saveSettings(settings) {
      return change((file) => {
        file.settings = { ...settings };
        return { ...file.settings };
      });
    },
  };
}

/** Fiche à relire dans la base : jamais lue, ou lue il y a plus de BASE_REREAD_DAYS jours. */
export function needsBaseRead(product: Product | null, now: Date): boolean {
  if (!product) return true;
  if (!product.baseReadAt) return false; // saisi à la main, jamais trouvé dans la base : on ne redemande pas à chaque scan
  return now.getTime() - Date.parse(product.baseReadAt) > BASE_REREAD_DAYS * 86_400_000;
}
