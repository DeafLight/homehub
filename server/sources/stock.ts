// Stock de la maison (stock.json dans le dossier d'état) : les produits connus par leur code-barres (copie de la base
// ou saisie à la main, en versions datées), ce qu'on en a, chaque entrée et sortie, et les contenants de la maison
// (bidon de lessive, bocal…) où l'on transvase les recharges. Les produits sans code-barres (vrac, marché, fait maison)
// y ont un identifiant interne (préfixe 28, voir shared/barcode.ts) et se comportent ensuite comme les autres.
// Ce qu'on a d'un produit est rangé en lots (unités entrées ensemble, ou de même date de péremption, facultative) :
// une sortie prend le lot à la date la plus proche, la quantité reste la somme des lots (règles : shared/expiry.ts).
// Un ancien fichier sans lots se lit comme un seul lot sans date. Un produit qui s'utilise en plusieurs fois peut
// garder la part restante de son paquet entamé (¼ · ½ · ¾, notée en cuisinant) ; une sortie l'efface (paquet fini,
// paquet vide scanné). Les mouvements d'un même décompte « J'ai cuisiné » portent un identifiant commun (`cook`) et
// leur raison (« Cuisiné : Pâtes au thon ») ; ils prennent les lots les plus proches (sans compter « jeté ») et
// s'annulent ensemble, chacun s'il est encore le dernier de son produit. Comme les listes : une modification à la
// fois, écrite sur le disque (fichier temporaire puis renommage) avant d'être confirmée.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { containerCode, isLooseCode, looseCode, looseNumber } from '../../shared/barcode.ts';
import { localDay } from '../../shared/dates.ts';
import { DEFAULT_EXPIRY, expiringItems, fefo, isExpired, storedLots, viewLot, viewLots, worstLot } from '../../shared/expiry.ts';
import type {
  Author,
  Container,
  DateKind,
  ExpiringSummary,
  ExpirySettings,
  LotChange,
  LotView,
  Product,
  ProductInfo,
  ProductPreferences,
  StockData,
  StockEntry,
  StockLot,
  StockMark,
  StockMovement,
  StockSettings,
} from '../../shared/types.ts';
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

const dateKindSchema = z.enum(['dlc', 'ddm']);
const lotSchema = z.object({
  id: z.string(),
  count: z.number().int().min(1),
  in: z.string(),
  date: z.string().nullable(),
  kind: dateKindSchema.nullable(),
  dismissed: z.boolean(),
});
const expirySchema = z.object({
  soonDlcDays: z.number().int().min(0),
  urgentDlcDays: z.number().int().min(0),
  soonDdmDays: z.number().int().min(0),
  defaults: z.record(z.string(), z.number().int().min(1)),
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
      /** Catégories Open Food Facts (absent : fiche lue avant qu'on les copie). */
      categories: z.array(z.string()).optional(),
      /** Dates de péremption (absents : fiche d'avant la 0.64, valeurs déduites du rayon). */
      dateKind: dateKindSchema.nullable().optional(),
      askDate: z.boolean().nullable().optional(),
      keepDays: z.number().int().min(1).nullable().optional(),
    }),
  ),
  /** `quantity` : somme des lots, gardée pour tout ce qui ne lit que le nombre. `lots` absent : ancien fichier. */
  stock: z.record(
    z.string(),
    z.object({
      quantity: z.number().int().min(0),
      updatedAt: z.string(),
      lots: z.array(lotSchema).optional(),
      /** Part restante du paquet entamé (0 à 1), notée en cuisinant ; absente : inconnue. */
      opened: z.number().min(0).max(1).nullable().optional(),
    }),
  ),
  movements: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      code: z.string(),
      /** « adjust » (quantité comptée) n'est plus écrit, mais reste lu : un ancien fichier peut en contenir. */
      kind: z.enum(['in', 'out', 'refill', 'adjust', 'container-empty', 'opened', 'date']),
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
        /** Contenance d'un produit sans code-barres avant une nouvelle quantité (voir setLoose). */
        looseQuantity: z.string().nullable().optional(),
        /** Part restante du paquet entamé avant le mouvement. */
        opened: z.number().nullable().optional(),
        /** Lots d'avant (date changée, quantité d'un produit sans code-barres) : remis tels quels. */
        lots: z.array(lotSchema).optional(),
      }),
      /** Décompte « J'ai cuisiné » dont le mouvement fait partie. */
      cook: z.string().optional(),
      /** Raison écrite dans l'historique (« Cuisiné : Pâtes au thon »). */
      reason: z.string().optional(),
      /** Part restante notée par le mouvement (paquet entamé). */
      opened: z.number().nullable().optional(),
      /** Entrée : le lot où elle est rangée ; date : le lot changé. */
      lotId: z.string().nullable().optional(),
      /** Sortie : ce qui est parti de chaque lot (remis si on annule). */
      taken: z.array(lotSchema).optional(),
      /** Unités sorties d'un lot dont la date était passée : « Jeté (périmé) ». */
      expired: z.number().int().min(0).optional(),
      /** Article ajouté d'office à la liste de courses (retiré si on annule). */
      shoppingId: z.string().nullable(),
      undone: z.boolean(),
    }),
  ),
  containers: z.array(containerSchema),
  nextContainer: z.number().int().min(1),
  settings: z.object({ autoShop: z.boolean(), expiry: expirySchema.optional() }),
});

type StockFile = z.infer<typeof fileSchema>;
type StoredProduct = StockFile['products'][string];
type Movement = StockFile['movements'][number];
type StoredContainer = z.infer<typeof containerSchema>;

export type BaseReading = { info: ProductInfo; image: string | null; base: string; categories: string[] };

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
  /** Lot d'où l'unité est partie (vu au moment de la sortie) ; null : tout sorti, ou entrée oubliée. */
  lot: LotView | null;
};

/** Ce qu'un décompte « J'ai cuisiné » change à un produit : paquets sortis, part restante (undefined : inchangée), ou contenant vidé. */
export type CookChange = { code: string; remove: number; opened?: number | null; container: string | null };

/** Ce qu'a donné une ligne du décompte, avant la décision sur la liste de courses. */
export type CookOut = { code: string; movementId: string; quantity: number; exhausted: boolean; autoShop: boolean };

/** Ce qu'a donné une entrée : le lot où elle est rangée. */
export type InResult = { movementId: string; at: string; quantity: number; lot: LotView | null };

/** Date d'une entrée (facultative). */
export type InDate = { date?: string | null; kind?: DateKind | null };

/** Options d'une sortie. `lotId` : ce lot plutôt que le plus proche ; `thrown` false : pas compté « jeté » (cuisiné). */
export type OutOptions = { all?: boolean; refill?: string | null; remaining?: number; lotId?: string | null; thrown?: boolean };

export type StockStore = {
  data(): Promise<StockData>;
  product(code: string): Promise<Product | null>;
  quantity(code: string): Promise<number>;
  /** Lots d'un produit vus aujourd'hui, dans l'ordre de sortie. */
  lots(code: string): Promise<LotView[]>;
  container(code: string): Promise<Container | null>;
  /** Fiche lue dans la base : nouvelle, relue (nouvelle version si elle a changé), ou conflit avec notre correction. */
  saveFromBase(code: string, reading: BaseReading): Promise<Product>;
  /** « Corriger », ou produit inconnu saisi : notre version, qui l'emporte sur la base. */
  saveManual(code: string, info: ProductInfo): Promise<Product>;
  /** Conflit avec la base : garder notre version, ou passer à celle de la base. */
  resolveConflict(code: string, take: 'mine' | 'base'): Promise<Product | null>;
  setPreferences(code: string, prefs: ProductPreferences): Promise<Product | null>;
  /**
   * Entrée de `count` unités (prix et date facultatifs). Sans date : rejoint le lot sans date entré le même jour (scans
   * d'un même passage) ; avec une date : le lot de même date et de même type.
   */
  add(code: string, count: number, price: number | null, by: Author, dated?: InDate): Promise<InResult>;
  /**
   * Sortie d'une unité (ou de tout ; `all` avec `lotId` : tout ce lot), du lot à la date la plus proche ; `refill` : l'emballage part mais le produit
   * reste, transvasé dans ce contenant. Produit absent du stock : acceptée (entrée oubliée), et `remaining` unités
   * restent en stock (lot sans date).
   */
  remove(code: string, options: OutOptions, by: Author): Promise<OutResult>;
  /** Date d'un lot, type, « Encore bon », ou une partie du lot à une autre date. null : lot inconnu. */
  setLot(lotId: string, change: LotChange, by: Author): Promise<{ code: string; product: Product; lot: LotView; quantity: number } | null>;
  /** DLC passées ou urgentes, et produits jetés périmés ce mois-ci (accueil, dashboard d'un parent, page Stock). */
  expiring(): Promise<ExpiringSummary>;
  /** Mouvements d'un produit (ou d'un contenant, par son étiquette), du plus récent au plus ancien. */
  movements(code: string, limit?: number): Promise<StockMovement[]>;
  /** Annule un mouvement, s'il est le dernier de son produit (ou de son contenant). Renvoie l'article de courses à retirer. */
  undo(movementId: string): Promise<{ ok: boolean; shoppingId: string | null; code: string | null }>;
  attachShopping(movementId: string, shoppingId: string): Promise<void>;
  /**
   * Décompte « J'ai cuisiné », d'un coup : N paquets sortis par produit (jamais plus que le stock), part restante du
   * paquet entamé, contenants vidés. Mouvements groupés sous `cook`, avec leur raison.
   */
  cook(cook: string, reason: string, changes: readonly CookChange[], by: Author): Promise<CookOut[]>;
  /**
   * Annule un décompte : chaque mouvement, du plus récent au plus ancien, s'il est encore le dernier de son produit.
   * `kept` : produits dont le mouvement reste (bougé depuis) ; `shoppingIds` : articles ajoutés d'office à retirer.
   */
  undoCook(cook: string): Promise<{ undone: string[]; kept: string[]; shoppingIds: string[] }>;
  addContainer(name: string): Promise<Container>;
  renameContainer(id: string, name: string): Promise<Container | null>;
  removeContainer(id: string): Promise<boolean>;
  /** Contenant vide : le produit qu'il contenait est concerné par la liste de courses. */
  emptyContainer(id: string, by: Author): Promise<(Omit<OutResult, 'forgotten' | 'quantity' | 'lot'> & { productCode: string | null }) | null>;
  /** Réglages changés (les autres restent). */
  saveSettings(settings: Partial<StockSettings>): Promise<StockSettings>;
  /** Produit sans code-barres : identifiant interne, fiche saisie à la main, et `count` unités entrées d'un coup. */
  addLoose(info: ProductInfo, count: number, by: Author): Promise<{ product: Product; movementId: string; at: string; quantity: number }>;
  /**
   * Nouvelle quantité d'un produit sans code-barres : contenance par unité (changée sur place, pas de nouvelle version)
   * et nombre d'unités, avec l'entrée ou la sortie qui y mène. null : pas un produit sans code-barres connu.
   */
  setLoose(code: string, change: { count: number; quantity: string }, by: Author): Promise<{ product: Product; movementId: string; at: string; quantity: number } | null>;
};

/** Identifiant du lot unique d'un ancien fichier (sans lots écrits) : stable, pour qu'on puisse le dater. */
const legacyLotId = (code: string) => `${code}-0`;

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
      categories: stored.categories ?? null,
      dateKind: stored.dateKind ?? null,
      askDate: stored.askDate ?? null,
      keepDays: stored.keepDays ?? null,
    };
  }

  const expiryOf = (file: StockFile): ExpirySettings => file.settings.expiry ?? DEFAULT_EXPIRY;
  const settingsOf = (file: StockFile): StockSettings => ({ autoShop: file.settings.autoShop, expiry: structuredClone(expiryOf(file)) });

  /** Lots d'un produit, à modifier sur place (un ancien fichier reçoit son lot sans date à la première écriture). */
  function lotsOf(file: StockFile, code: string): StockLot[] {
    const entry = file.stock[code];
    if (!entry) return [];
    entry.lots = storedLots(entry, legacyLotId(code));
    return entry.lots;
  }

  /** Lots vus aujourd'hui (lecture seule). */
  function lotViews(file: StockFile, code: string, now: Date): LotView[] {
    const entry = file.stock[code];
    const product = productOf(file, code);
    if (!entry || !product) return [];
    return viewLots(storedLots(entry, legacyLotId(code)), product, expiryOf(file), localDay(now));
  }

  function viewOf(file: StockFile, code: string, lot: StockLot | undefined, now: Date): LotView | null {
    const product = productOf(file, code);
    return lot && product ? viewLot(lot, product, expiryOf(file), localDay(now)) : null;
  }

  /**
   * Remet `quantity` à la somme des lots (lots vides retirés). La part restante du paquet entamé est gardée, sauf
   * `opened` donné ou plus rien en stock.
   */
  function syncQuantity(file: StockFile, code: string, lots: StockLot[], now: Date, opened?: number | null) {
    const kept = lots.filter((l) => l.count > 0);
    const quantity = kept.reduce((n, l) => n + l.count, 0);
    const part = opened === undefined ? (file.stock[code]?.opened ?? null) : opened;
    file.stock[code] = { quantity, updatedAt: now.toISOString(), lots: kept, ...(quantity > 0 && part !== null && { opened: part }) };
  }

  const newLot = (count: number, now: Date, date: string | null = null, kind: DateKind | null = null): StockLot => ({
    id: randomUUID(),
    count,
    in: now.toISOString(),
    date,
    kind,
    dismissed: false,
  });

  /** Retire `count` unités, des lots les plus tardifs d'abord (sans date, puis dates lointaines) : quantité corrigée. */
  function takeLatest(lots: StockLot[], count: number) {
    let left = count;
    for (const lot of fefo(lots).reverse()) {
      if (left <= 0) break;
      const part = Math.min(lot.count, left);
      lot.count -= part;
      left -= part;
    }
  }

  /** Amène un produit à `target` unités : lot sans date pour ce qui manque, retrait des plus tardifs pour le surplus. */
  function setCount(file: StockFile, code: string, target: number, now: Date, opened?: number | null) {
    const lots = lotsOf(file, code);
    const current = lots.reduce((n, l) => n + l.count, 0);
    if (target > current) lots.push(newLot(target - current, now));
    else takeLatest(lots, current - target);
    syncQuantity(file, code, lots, now, opened);
  }

  /** Sort `count` unités des lots les plus proches (FEFO) ; renvoie ce qui est parti de chaque lot. */
  function takeFefo(lots: StockLot[], count: number): StockLot[] {
    const taken: StockLot[] = [];
    let left = count;
    for (const lot of fefo(lots)) {
      if (left <= 0) break;
      const part = Math.min(lot.count, left);
      if (part === 0) continue;
      taken.push({ ...lot, count: part });
      lot.count -= part;
      left -= part;
    }
    return taken;
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

  const openedOf = (file: StockFile, code: string) => file.stock[code]?.opened ?? null;

  /**
   * Un mouvement plus récent du même produit (ou du même contenant) : on ne peut plus annuler celui-ci. Une date donnée
   * ensuite n'empêche pas d'annuler l'entrée (« Date ? » puis « Annuler » au scanner).
   */
  function newer(file: StockFile, movement: Movement) {
    const containerId = movement.before.container?.id;
    return file.movements
      .slice(file.movements.indexOf(movement) + 1)
      .some(
        (m) =>
          !m.undone &&
          (movement.kind === 'date' || m.kind !== 'date') &&
          (m.code === movement.code || (containerId !== undefined && m.before.container?.id === containerId)),
      );
  }

  /** Remet l'état d'avant un mouvement (lots, part entamée, contenant) et le marque annulé ; renvoie l'article de courses ajouté d'office. */
  function revert(file: StockFile, movement: Movement, now: Date) {
    const opened = movement.before.opened;
    if (movement.before.lots) syncQuantity(file, movement.code, movement.before.lots.map((l) => ({ ...l })), now, opened);
    else if (movement.kind === 'in' && movement.lotId) {
      // L'entrée repart de son lot (même si une date lui a été donnée depuis) ; le reste, des plus tardifs.
      const lots = lotsOf(file, movement.code);
      const lot = lots.find((l) => l.id === movement.lotId);
      const part = Math.min(lot?.count ?? 0, movement.count);
      if (lot) lot.count -= part;
      takeLatest(lots, movement.count - part);
      syncQuantity(file, movement.code, lots, now, opened);
    } else if (movement.taken) {
      // La sortie revient dans ses lots (recréés s'ils avaient disparu) ; une entrée oubliée repart.
      const lots = lotsOf(file, movement.code);
      if (movement.forgotten) for (const l of lots) l.count = 0;
      for (const t of movement.taken) {
        const lot = lots.find((l) => l.id === t.id);
        if (lot) lot.count += t.count;
        else lots.push({ ...t });
      }
      syncQuantity(file, movement.code, lots, now, opened);
    } else if (movement.before.quantity !== null) setCount(file, movement.code, movement.before.quantity, now, opened);
    else if (opened !== undefined) syncQuantity(file, movement.code, lotsOf(file, movement.code), now, opened);
    const stored = file.products[movement.code];
    if (stored && movement.before.refill !== undefined) stored.refill = movement.before.refill;
    const version = stored?.versions.at(-1);
    if (version && movement.before.looseQuantity !== undefined) version.quantity = movement.before.looseQuantity;
    if (movement.before.container) {
      const container = file.containers.find((c) => c.id === movement.before.container?.id);
      if (container) Object.assign(container, movement.before.container);
    }
    movement.undone = true;
    return movement.shoppingId;
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
      if (m.undone || m.kind === 'adjust' || m.kind === 'opened' || m.kind === 'date') continue;
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
        const now = clock();
        const items: StockEntry[] = Object.entries(file.products).map(([code, stored]) => {
          const lots = lotViews(file, code, now);
          return {
            product: toProduct(code, stored),
            quantity: quantityOf(file, code),
            updatedAt: file.stock[code]?.updatedAt ?? null,
            lastIn: marks.get(code)?.lastIn ?? null,
            lastOut: marks.get(code)?.lastOut ?? null,
            opened: openedOf(file, code),
            lots,
            expiry: worstLot(lots),
          };
        });
        items.sort(
          (a, b) =>
            Number(b.quantity > 0) - Number(a.quantity > 0) ||
            a.product.current.name.localeCompare(b.product.current.name, 'fr', { sensitivity: 'base' }),
        );
        return { items, containers: file.containers.map((c) => toContainer(file, c)), settings: settingsOf(file) };
      }),

    expiring: () =>
      read((file) => {
        const now = clock();
        const entries = Object.entries(file.products).map(([code, stored]) => ({ product: toProduct(code, stored), lots: lotViews(file, code, now) }));
        const month = localDay(now).slice(0, 7);
        const thrownThisMonth = file.movements
          .filter((m) => !m.undone && m.expired && localDay(new Date(m.at)).slice(0, 7) === month)
          .reduce((n, m) => n + (m.expired ?? 0), 0);
        return { items: expiringItems(entries), thrownThisMonth };
      }),

    product: (code) => read((file) => productOf(file, code)),
    movements: (code, limit = 50) =>
      read((file) =>
        file.movements
          .filter((m) => m.code === code)
          .slice(-limit)
          .reverse()
          .map(({ id, at, kind, count, price, by, forgotten, undone, reason, opened, expired }) => ({
            id,
            at,
            kind,
            count,
            price,
            by: { ...by },
            forgotten,
            undone,
            reason: reason ?? null,
            opened: opened ?? null,
            expired: expired ?? 0,
          })),
      ),
    quantity: (code) => read((file) => quantityOf(file, code)),
    lots: (code) => read((file) => lotViews(file, code, clock())),
    container: (code) =>
      read((file) => {
        const found = file.containers.find((c) => c.code === code);
        return found ? toContainer(file, found) : null;
      }),

    saveFromBase(code, { info, image, base, categories }) {
      return change((file, now) => {
        const stored = file.products[code];
        const version = { ...info, from: now.toISOString(), source: 'base' as const, base };
        if (!stored) {
          file.products[code] = { versions: [version], image, autoShop: null, refill: null, conflict: null, baseReadAt: now.toISOString(), categories };
          return productOf(file, code) as Product;
        }
        stored.baseReadAt = now.toISOString();
        stored.image = image ?? stored.image;
        stored.categories = categories;
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
        if (prefs.dateKind !== undefined) stored.dateKind = prefs.dateKind;
        if (prefs.askDate !== undefined) stored.askDate = prefs.askDate;
        if (prefs.keepDays !== undefined) stored.keepDays = prefs.keepDays;
        return productOf(file, code);
      });
    },

    add(code, count, price, by, { date = null, kind = null } = {}) {
      return change((file, now) => {
        const before = quantityOf(file, code);
        const lots = lotsOf(file, code);
        const today = localDay(now);
        // Même passage (même jour, sans date) ou même date imprimée : un seul lot.
        let lot = date
          ? lots.find((l) => l.date === date && l.kind === kind && !l.dismissed)
          : lots.find((l) => l.date === null && localDay(new Date(l.in)) === today);
        if (lot) lot.count += count;
        else {
          lot = newLot(count, now, date, kind);
          lots.push(lot);
        }
        syncQuantity(file, code, lots, now);
        const stored = file.products[code];
        if (date && stored) {
          stored.askDate ??= true;
          if (kind) stored.dateKind = kind;
        }
        const movement = record(file, now, { code, kind: 'in', count, price, by, before: { quantity: before }, lotId: lot.id });
        return { movementId: movement.id, at: movement.at, quantity: quantityOf(file, code), lot: viewOf(file, code, lot, now) };
      });
    },

    remove(code, { all = false, refill = null, remaining = 0, lotId = null, thrown = true }, by) {
      return change((file, now) => {
        const before = quantityOf(file, code);
        const stored = file.products[code];
        const forgotten = before === 0;
        // Paquet vide scanné, ou sorti à la main : le paquet entamé est parti avec.
        const openedBefore = openedOf(file, code);
        const lots = lotsOf(file, code);
        const views = lotViews(file, code, now);
        let taken: StockLot[] = [];
        if (forgotten) {
          // Entrée oubliée : la sortie passe quand même ; ce qui reste entre au stock (sans prix ni date).
          if (remaining > 0) lots.push(newLot(remaining, now));
        } else if (all && lots.some((l) => l.id === lotId)) {
          // « Jeté » sur un lot de la page Stock : tout ce lot-là, pas les autres.
          const lot = lots.find((l) => l.id === lotId) as StockLot;
          taken = [{ ...lot }];
          lot.count = 0;
        } else if (all) {
          taken = lots.map((l) => ({ ...l }));
          for (const l of lots) l.count = 0;
        } else {
          const lot = lots.find((l) => l.id === lotId) ?? (fefo(lots)[0] as StockLot);
          taken = [{ ...lot, count: 1 }];
          lot.count -= 1;
        }
        syncQuantity(file, code, lots, now, null);
        const after = quantityOf(file, code);
        let container: StoredContainer | undefined;
        let containerBefore: StoredContainer | null = null;
        if (refill) {
          container = file.containers.find((c) => c.id === refill);
          if (container) {
            containerBefore = { ...container };
            Object.assign(container, { productCode: code, full: true });
          }
        }
        // Jeté (périmé) : unités d'un lot dont la date imprimée était passée (pas transvasé, pas cuisiné).
        const expired = thrown && !container ? taken.reduce((n, t) => n + (views.some((v) => v.id === t.id && isExpired(v)) ? t.count : 0), 0) : 0;
        const movement = record(file, now, {
          code,
          kind: container ? 'refill' : 'out',
          count: forgotten ? 1 : before - after,
          price: null,
          by,
          forgotten,
          before: { quantity: before, refill: stored?.refill ?? null, container: containerBefore, opened: openedBefore },
          taken,
          lotId: taken[0]?.id ?? null,
          ...(expired ? { expired } : {}),
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
          lot: taken.length === 1 ? (views.find((v) => v.id === taken[0].id) ?? null) : null,
        };
      });
    },

    setLot(lotId, wanted, by) {
      return change((file, now) => {
        const code = Object.keys(file.stock).find((c) => storedLots(file.stock[c], legacyLotId(c)).some((l) => l.id === lotId));
        const stored = code ? file.products[code] : undefined;
        if (!code || !stored) return null;
        const lots = lotsOf(file, code);
        const before = { quantity: quantityOf(file, code), lots: lots.map((l) => ({ ...l })) };
        let lot = lots.find((l) => l.id === lotId) as StockLot;
        if (wanted.split && wanted.split.count < lot.count) {
          lot.count -= wanted.split.count;
          lot = { ...lot, id: randomUUID(), count: wanted.split.count, date: wanted.split.date, kind: wanted.kind ?? lot.kind, dismissed: false };
          lots.push(lot);
        } else if (wanted.split) {
          lot.date = wanted.split.date;
          lot.dismissed = false;
        }
        if (wanted.date !== undefined && wanted.date !== lot.date) {
          lot.date = wanted.date;
          lot.dismissed = false;
        }
        if (wanted.kind !== undefined) {
          lot.kind = wanted.kind;
          if (wanted.kind) stored.dateKind = wanted.kind;
        }
        if (wanted.dismissed !== undefined) lot.dismissed = wanted.dismissed;
        if (lot.date) stored.askDate ??= true;
        // Même date et même type qu'un autre lot : un seul lot (celui qu'on vient de changer garde son identifiant).
        const twin = lot.date ? lots.find((l) => l !== lot && l.date === lot.date && l.kind === lot.kind && l.dismissed === lot.dismissed) : undefined;
        if (twin) {
          lot.count += twin.count;
          if (twin.in < lot.in) lot.in = twin.in;
          twin.count = 0;
        }
        syncQuantity(file, code, lots, now);
        record(file, now, { code, kind: 'date', count: 0, price: null, by, before, lotId: lot.id });
        return { code, product: productOf(file, code) as Product, lot: viewOf(file, code, lot, now) as LotView, quantity: quantityOf(file, code) };
      });
    },

    undo(movementId) {
      return change((file, now) => {
        const movement = file.movements.find((m) => m.id === movementId);
        if (!movement || movement.undone) return { ok: false, shoppingId: null, code: null };
        // Seulement le dernier mouvement de ce produit (et de ce contenant) : annuler plus ancien fausserait la suite.
        if (newer(file, movement)) return { ok: false, shoppingId: null, code: movement.code };
        return { ok: true, shoppingId: revert(file, movement, now), code: movement.code };
      });
    },

    attachShopping(movementId, shoppingId) {
      return change((file) => {
        const movement = file.movements.find((m) => m.id === movementId);
        if (movement) movement.shoppingId = shoppingId;
      });
    },

    cook(cook, reason, changes, by) {
      return change((file, now) => {
        const results: CookOut[] = [];
        for (const { code, remove, opened, container: containerId } of changes) {
          if (containerId) {
            const container = file.containers.find((c) => c.id === containerId);
            if (!container) continue;
            const movement = record(file, now, { code: container.productCode ?? container.code, kind: 'container-empty', count: 0, price: null, by, before: { quantity: null, container: { ...container } }, cook, reason });
            const wasFull = container.full;
            container.full = false;
            const productCode = container.productCode;
            const exhausted = wasFull && productCode !== null && quantityOf(file, productCode) === 0;
            results.push({ code: productCode ?? container.code, movementId: movement.id, quantity: productCode ? quantityOf(file, productCode) : 0, exhausted, autoShop: productCode ? autoShopOf(file, productCode) : false });
            continue;
          }
          const before = quantityOf(file, code);
          const count = Math.min(remove, before);
          const openedBefore = openedOf(file, code);
          // Des paquets finis sans estimation : le suivant n'est pas entamé (ou on ne sait pas combien il en reste).
          const next = opened === undefined ? (count > 0 ? null : openedBefore) : opened;
          if (count === 0 && next === openedBefore) continue;
          // Cuisiné : les lots les plus proches partent d'abord, jamais comptés « jeté (périmé) ».
          const lots = lotsOf(file, code);
          const taken = takeFefo(lots, count);
          syncQuantity(file, code, lots, now, next);
          const movement = record(file, now, {
            code,
            kind: count > 0 ? 'out' : 'opened',
            count,
            price: null,
            by,
            before: { quantity: before, opened: openedBefore },
            cook,
            reason,
            ...(next !== null && { opened: next }),
            ...(taken.length > 0 && { taken, lotId: taken[0].id }),
          });
          const after = quantityOf(file, code);
          results.push({ code, movementId: movement.id, quantity: after, exhausted: count > 0 && after === 0, autoShop: autoShopOf(file, code) });
        }
        return results;
      });
    },

    undoCook(cook) {
      return change((file, now) => {
        const result = { undone: [] as string[], kept: [] as string[], shoppingIds: [] as string[] };
        const group = file.movements.filter((m) => m.cook === cook && !m.undone).reverse();
        for (const movement of group) {
          if (newer(file, movement)) {
            result.kept.push(movement.code);
            continue;
          }
          const shoppingId = revert(file, movement, now);
          if (shoppingId) result.shoppingIds.push(shoppingId);
          result.undone.push(movement.code);
        }
        return result;
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

    addLoose(info, count, by) {
      return change((file, now) => {
        const used = Object.keys(file.products).filter(isLooseCode).map(looseNumber);
        const code = looseCode(Math.max(0, ...used) + 1);
        const version = { ...info, brand: null, from: now.toISOString(), source: 'manual' as const, base: null };
        file.products[code] = { versions: [version], image: null, autoShop: null, refill: null, conflict: null, baseReadAt: null };
        const lot = newLot(count, now);
        syncQuantity(file, code, [lot], now);
        const movement = record(file, now, { code, kind: 'in', count, price: null, by, before: { quantity: 0 }, lotId: lot.id });
        return { product: productOf(file, code) as Product, movementId: movement.id, at: movement.at, quantity: count };
      });
    },

    setLoose(code, { count, quantity }, by) {
      return change((file, now) => {
        const stored = file.products[code];
        if (!stored || !isLooseCode(code)) return null;
        const current = stored.versions.at(-1) as StoredProduct['versions'][number];
        const before = { quantity: quantityOf(file, code), looseQuantity: current.quantity, lots: lotsOf(file, code).map((l) => ({ ...l })) };
        current.quantity = quantity;
        setCount(file, code, count, now);
        // Entrée ou sortie de la différence (zéro si seule la contenance change : 1,2 kg → 800 g) ; l'annuler rend
        // aussi l'ancienne contenance.
        const movement = record(file, now, { code, kind: count >= before.quantity ? 'in' : 'out', count: Math.abs(count - before.quantity), price: null, by, before });
        return { product: productOf(file, code) as Product, movementId: movement.id, at: movement.at, quantity: count };
      });
    },

    saveSettings(settings) {
      return change((file) => {
        file.settings = { autoShop: settings.autoShop ?? file.settings.autoShop, expiry: structuredClone(settings.expiry ?? expiryOf(file)) };
        return settingsOf(file);
      });
    },
  };
}

/**
 * Fiche à relire dans la base : jamais lue, lue il y a plus de BASE_REREAD_DAYS jours, ou lue avant qu'on copie les
 * catégories (une seule fois : ensuite elles sont copiées, même vides).
 */
export function needsBaseRead(product: Product | null, now: Date): boolean {
  if (!product) return true;
  if (!product.baseReadAt) return false; // saisi à la main, jamais trouvé dans la base : on ne redemande pas à chaque scan
  if (product.categories === null) return true;
  return now.getTime() - Date.parse(product.baseReadAt) > BASE_REREAD_DAYS * 86_400_000;
}
