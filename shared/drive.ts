// Drive : relier un article de la liste de courses à un produit d'une enseigne, choisi une fois puis retenu (étape 1),
// puis remplir le panier de l'enseigne à la main avec la liste à cocher que HomeHub prépare (étape 2).
// Partagé entre le serveur (qui lit la fiche partagée et garde les choix dans drive.json) et le front (qui affiche).
// Rien ne cherche dans le catalogue de l'enseigne : la personne partage ou colle le lien d'une fiche produit, dont on
// tire l'identifiant ; la fiche peut être lue une fois, à sa demande (JSON-LD `Product` : nom, contenance, EAN), et si
// le site refuse, on saisit le nom et la contenance, ou on les reprend d'un produit du stock (par EAN).
//
// Un article est désigné par sa clé : celle de l'ingrédient pour une ligne du menu, celle de son libellé pour un
// produit hors recettes (« Lessive »), comme pour le reste de la liste. Un choix porte un produit retenu et des
// produits de secours, jamais pris d'office (retirer le produit retenu ne promeut pas un secours).
// Une seule enseigne pour l'instant (Courses U) ; chaque enseigne a son adaptateur (hôtes, forme des liens).
//
// Étape 2, « Remplir le panier » : pour chaque article à acheter, le produit retenu et le nombre de paquets
// (driveCount). Grandeurs qui ne se comparent pas (« 2 oignons » contre un filet de 1 kg) : on demande une fois
// combien de pièces contient le paquet, retenu sur le produit (`pieces`) ; contenance illisible, produit au poids ou
// autre grandeur : 1 paquet, signalé. Un seul panier en cours (DriveBasket) : la personne le remplit dans l'appli de
// l'enseigne et coche ici ; chaque ligne cochée est liée à un article de la liste par son identifiant, et marque cet
// article « au drive » sans le cocher comme acheté. Récapitulatif (driveRecap) : ce qui part au drive, ce qui reste
// à mettre au panier, ce qui s'achète ailleurs.
//
// Étape 3, extension « Remplir le panier » (voir drive-cart.ts) : le dernier prix d'un paquet vu sur la fiche par
// l'extension est retenu sur le produit (`price`, indicatif) ; le récapitulatif en fait un total indicatif.
import { ingredientKey, parseIngredient, type Unit, unitLabel } from './ingredients.ts';
import { formatPacks, type Packs, packsFor } from './menu.ts';
import { type Amount, dimensionOf, parsePackage } from './quantities.ts';
import type { Author, ShoppingItem } from './types.ts';

export const ENSEIGNES = ['coursesu'] as const;
export type Enseigne = (typeof ENSEIGNES)[number];

type Adapter = {
  name: string;
  /** Domaine du site (et ses sous-domaines). */
  domain: string;
  /** Fiche produit : chemin → identifiant de l'enseigne, ou null. */
  productId(path: string): string | null;
};

const ADAPTERS: Record<Enseigne, Adapter> = {
  coursesu: {
    name: 'Courses U',
    domain: 'coursesu.com',
    // /p/<nom>/<identifiant>.html (l'identifiant est le `mpn` du JSON-LD de la fiche).
    productId: (path) => /^\/p\/[^/]+\/([A-Za-z0-9_-]{3,40})\.html$/u.exec(path)?.[1] ?? null,
  },
};

export const enseigneName = (enseigne: Enseigne) => ADAPTERS[enseigne].name;

export const DRIVE_LIMITS = { choices: 500, fallback: 3, name: 120, brand: 80, pack: 40, storeName: 80, url: 500, pieces: 500, basket: 300 } as const;

/** Produit d'une enseigne, tel qu'on l'a retenu (lu sur la fiche, saisi, ou repris du stock). */
export type DriveProduct = {
  enseigne: Enseigne;
  /** Identifiant de l'enseigne (`mpn` chez Courses U). */
  id: string;
  /** Lien de la fiche. */
  url: string;
  name: string;
  brand: string | null;
  /** Contenance telle qu'écrite (« 400 g ») et lue (null : illisible ou inconnue). */
  packText: string | null;
  pack: Amount | null;
  /** EAN-13 (code-barres), s'il est connu : relie au stock. */
  ean: string | null;
  /** D'où viennent le nom et la contenance. */
  source: 'page' | 'manual' | 'stock';
  seenAt: string;
  /**
   * Pièces (ou gousses, bottes…) dans un paquet, demandées une fois quand l'article se compte autrement que la
   * contenance (« 2 oignons » contre un filet de 1 kg) ; null : pas encore demandé.
   */
  pieces: number | null;
  /**
   * Dernier prix d'un paquet vu sur la fiche par l'extension « Remplir le panier » (magasin de retrait choisi sur le
   * site), indicatif ; null : jamais vu.
   */
  price: DrivePrice | null;
};

/** Prix d'un paquet vu sur la fiche, et quand. */
export type DrivePrice = { value: number; at: string };

/** Choix retenu pour un article chez une enseigne. */
export type DriveChoice = {
  key: string;
  enseigne: Enseigne;
  /** Libellé de l'article quand le choix a été fait (« Lardons »). */
  label: string;
  /** Produit retenu ; null : seulement des secours (aucun n'est pris d'office). */
  preferred: DriveProduct | null;
  fallback: DriveProduct[];
  updatedAt: string;
  updatedBy: Author;
};

/** Magasin de retrait : un nom libre, et si on veut le lien de sa page chez l'enseigne. */
export type DriveStore = { name: string; url: string | null };

export type DriveSettings = { enseigne: Enseigne | null; store: DriveStore | null };

/** Produit du stock qui ressemble à l'article (lien du menu ou nom), pour reprendre son EAN et sa contenance. */
export type DriveStockHint = { ean: string; name: string; brand: string | null; quantity: string | null };

/** Ligne du panier en cours : un article de la liste mis au panier de l'enseigne, avec ce qu'on y a mis. */
export type DriveBasketLine = {
  /** Article de la liste de courses (son identifiant) : il est marqué « au drive » tant que la ligne existe. */
  itemId: string;
  key: string;
  label: string;
  /** Produit mis au panier ; null : article mis au panier sans produit retenu (trouvé dans l'appli). */
  product: Pick<DriveProduct, 'id' | 'name' | 'url'> | null;
  /** Paquets mis au panier, et leur contenance si on la connaît. */
  count: number;
  per: Amount | null;
  at: string;
  by: Author;
};

/** Panier en cours chez une enseigne : ce qu'on y a mis, coché pendant qu'on le remplit dans son appli. */
export type DriveBasket = { enseigne: Enseigne; startedAt: string; startedBy: Author; lines: DriveBasketLine[] };

/** GET /api/drive (`basket` : seulement les lignes dont l'article est encore dans la liste). */
export type DriveView = { settings: DriveSettings; choices: DriveChoice[]; basket: DriveBasket | null };

/** Ce qu'on sait d'un produit avant de le retenir (lecture de la fiche, ou seulement son lien). */
export type DriveProductDraft = Pick<DriveProduct, 'enseigne' | 'id' | 'url' | 'name' | 'brand' | 'packText' | 'ean'>;

/**
 * POST /api/drive/read : la fiche lue (`read`), ou seulement ce que dit le lien, avec la raison (`refused` : le site
 * refuse la lecture par HomeHub ; on ne contourne pas).
 */
export type DriveReadResult = { read: true; product: DriveProductDraft } | { read: false; product: DriveProductDraft; reason: string; refused?: boolean };

// --- Liens ---

function urlOf(raw: string): URL | null {
  const match = /https?:\/\/[^\s<>"']+/iu.exec(raw)?.[0].replace(/[).,;!?»]+$/u, '');
  if (!match) return null;
  try {
    return new URL(match);
  } catch {
    return null;
  }
}

const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/\.$/u, '');
const onDomain = (url: URL, domain: string) => hostOf(url) === domain || hostOf(url).endsWith(`.${domain}`);

/** Enseigne d'un lien (son site), ou null. */
export function enseigneOf(raw: string): Enseigne | null {
  const url = urlOf(raw);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
  return ENSEIGNES.find((e) => onDomain(url, ADAPTERS[e].domain)) ?? null;
}

/**
 * Fiche produit d'une enseigne dans un lien (ou un texte partagé qui en contient un) : l'enseigne, l'identifiant et
 * l'adresse nettoyée (https, sans paramètres ni ancre). null : pas une fiche produit d'une enseigne connue.
 */
export function productLink(raw: string): { enseigne: Enseigne; id: string; url: string } | null {
  const url = urlOf(raw);
  const enseigne = url ? enseigneOf(url.toString()) : null;
  if (!url || !enseigne) return null;
  const id = ADAPTERS[enseigne].productId(url.pathname);
  return id ? { enseigne, id, url: `https://${hostOf(url)}${url.pathname}` } : null;
}

/** Lien de la page du magasin chez l'enseigne choisie (nettoyé), ou null s'il n'est pas sur son site. */
export function storeLink(raw: string, enseigne: Enseigne): string | null {
  const url = urlOf(raw);
  if (!url || !onDomain(url, ADAPTERS[enseigne].domain)) return null;
  return `https://${hostOf(url)}${url.pathname}`.slice(0, DRIVE_LIMITS.url);
}

// --- Fiche produit ---

const PACK_IN_NAME = /(\d+(?:[.,]\d+)?\s*[x×]\s*)?\d+(?:[.,]\d+)?\s*(kg|g|mg|cl|dl|ml|l)\b/giu;

/** Contenance écrite dans un nom de produit (« Lardons fumés, 2x100g » → « 2x100g »), la dernière trouvée. */
export function packFromName(name: string): string | null {
  const found = [...name.matchAll(PACK_IN_NAME)].map((m) => m[0]).filter((t) => parsePackage(t));
  return found.at(-1)?.replace(/\s+/gu, ' ') ?? null;
}

/** EAN-8 à EAN-13 (UPC compris), complété de zéros à 13 chiffres ; null si ce n'en est pas un. */
export function normalizeEan(value: unknown): string | null {
  const digits = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{8,14}$/u.test(digits)) return null;
  const padded = digits.padStart(14, '0');
  return padded.startsWith('0') ? padded.slice(1) : null;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/gu, ' ').trim().slice(0, max) : '');

/**
 * Nœud JSON-LD `Product` d'une fiche → brouillon de produit. `link` : la fiche partagée (enseigne et identifiant de
 * l'URL, qui l'emporte sur un `mpn` absent). Contenance : `weight` s'il est lisible, sinon écrite dans le nom.
 */
export function productFromJsonLd(node: Json, link: { enseigne: Enseigne; id: string; url: string }): DriveProductDraft {
  const name = text(node.name, DRIVE_LIMITS.name) || link.id;
  const brand = isObject(node.brand) ? text(node.brand.name, DRIVE_LIMITS.brand) : text(node.brand, DRIVE_LIMITS.brand);
  const ean = [node.gtin13, node.gtin, node.ean, node.sku, node.gtin8, node.gtin12].map(normalizeEan).find(Boolean) ?? null;
  let packText: string | null = null;
  if (isObject(node.weight)) {
    const weight = `${text(String(node.weight.value ?? ''), 12)} ${text(node.weight.unitText ?? node.weight.unitCode, 8)}`.trim();
    if (parsePackage(weight)) packText = weight;
  }
  packText ??= packFromName(name);
  return { enseigne: link.enseigne, id: link.id, url: link.url, name, brand: brand || null, packText, ean };
}

// --- Liste de courses ---

/** Clé d'un article : l'ingrédient d'une ligne du menu, sinon celle de son libellé. */
export function itemKey(item: Pick<ShoppingItem, 'label' | 'menu'>): string {
  if (item.menu) return item.menu.key;
  const name = parseIngredient(item.label.split(' · ')[0]).name;
  return ingredientKey(name) || item.label.trim().toLowerCase();
}

/** Nom d'un article, sans la quantité ajoutée par le menu (« Gruyère · 250 g » → « Gruyère »). */
export const itemName = (item: Pick<ShoppingItem, 'label'>) => item.label.split(' · ')[0].replace(/ \(facultatif\)$/u, '').trim();

/** Choix d'un article chez une enseigne. */
export function choiceFor(choices: readonly DriveChoice[], key: string, enseigne: Enseigne): DriveChoice | null {
  return choices.find((c) => c.key === key && c.enseigne === enseigne) ?? null;
}

const MEASURED = new Set(['masse', 'volume', 'cuillere']);

/** Seule grandeur d'une ligne du menu à acheter (« piece », « masse »…), ou null (plusieurs, ou rien). */
function lineDimension(item: Pick<ShoppingItem, 'menu'>): { dimension: string; value: number } | null {
  const entries = Object.entries(item.menu?.quantities ?? {}).filter((e): e is [string, number] => (e[1] ?? 0) > 1e-9);
  return entries.length === 1 ? { dimension: entries[0][0], value: entries[0][1] } : null;
}

/**
 * Unité comptée (pièces, gousses, bottes…) d'une ligne du menu qui ne se compare pas à la contenance du produit
 * (« 2 oignons » contre un filet de 1 kg, ou contenance inconnue) : il faut savoir combien le paquet en contient.
 * null : rien à demander (grandeurs comparables, ligne au poids ou au volume, article hors recettes).
 */
export function piecesUnit(item: Pick<ShoppingItem, 'menu'>, product: Pick<DriveProduct, 'pack'> | null): Unit | null {
  const line = lineDimension(item);
  if (!line || MEASURED.has(line.dimension) || !product) return null;
  if (product.pack && dimensionOf(product.pack.unit).dimension === line.dimension) return null;
  return line.dimension as Unit;
}

/** « Combien de pièces dans ce paquet ? », « Combien de gousses dans ce paquet ? ». */
export const piecesQuestion = (unit: Unit) => `Combien de ${unit === 'piece' ? 'pièces' : unitLabel(unit, 2)} dans ce paquet ?`;

/**
 * Paquets du produit retenu pour une ligne du menu, avec l'arrondi au paquet de la liste (packsFor) : « 2 × 200 g ».
 * Ligne comptée en pièces et paquet d'une autre grandeur : d'après les pièces par paquet, si on les a dites
 * (« 5 oignons », filet de 1 kg de 6 pièces → 1 × 1 kg). null : article hors recettes, contenance inconnue ou
 * grandeurs qui ne se comparent pas.
 */
export function drivePacks(item: Pick<ShoppingItem, 'menu'>, product: (Pick<DriveProduct, 'pack'> & { pieces?: number | null }) | null): Packs | null {
  if (!item.menu || !product) return null;
  const unit = piecesUnit(item, product);
  if (unit && product.pieces) {
    const line = lineDimension(item)!;
    return { count: Math.max(1, Math.ceil(line.value / product.pieces - 1e-9)), per: product.pack ?? { quantity: product.pieces, unit } };
  }
  if (!product.pack) return null;
  return packsFor(item.menu.quantities, [product.pack]);
}

/**
 * Ce qu'on met au panier pour un article : le nombre de paquets et leur contenance. Quand le calcul n'est pas
 * possible, 1 paquet, signalé (`flag`) : `pieces` (combien de pièces dans le paquet ? à demander), `pack` (contenance
 * inconnue ou illisible), `mismatch` (produit au poids ou autre grandeur que la ligne). Article hors recettes ou sans
 * quantité (« persil ») : 1 paquet, sans signal.
 */
export type DriveCount = { count: number; per: Amount | null; flag: 'pieces' | 'pack' | 'mismatch' | null };

export function driveCount(item: Pick<ShoppingItem, 'menu'>, product: Pick<DriveProduct, 'pack' | 'pieces'>): DriveCount {
  const quantities = Object.values(item.menu?.quantities ?? {}).some((v) => (v ?? 0) > 1e-9);
  if (!item.menu || !quantities) return { count: 1, per: product.pack, flag: null };
  const packs = drivePacks(item, product);
  if (packs) return { count: packs.count, per: packs.per, flag: null };
  if (piecesUnit(item, product)) return { count: 1, per: product.pack, flag: 'pieces' };
  return { count: 1, per: product.pack, flag: product.pack ? 'mismatch' : 'pack' };
}

/** « 2 × 200 g », « 1 paquet », « 3 paquets ». */
export const formatCount = ({ count, per }: Pick<DriveCount, 'count' | 'per'>) => (per ? formatPacks({ count, per }) : `${count} paquet${count > 1 ? 's' : ''}`);

/** Ce que dit le signal d'un nombre de paquets non calculé, ou null. */
export function countFlag(flag: DriveCount['flag']): string | null {
  if (flag === 'pieces') return 'Pièces par paquet à dire : 1 paquet en attendant';
  if (flag === 'pack') return 'Contenance inconnue : 1 paquet, à vérifier';
  if (flag === 'mismatch') return 'Au poids ou autre grandeur que la liste : 1 paquet, à vérifier';
  return null;
}

// --- Remplir le panier ---

/**
 * Un article à acheter dans le mode « Remplir le panier » : son choix chez l'enseigne, son état (`ready` : produit
 * retenu ; `fallback` : seulement des secours, jamais pris d'office ; `none` : aucun produit), ce qu'il faut mettre au
 * panier, et sa ligne du panier s'il est coché. `changed` : la ligne cochée ne correspond plus à ce qu'il faut
 * (quantité ou produit changés depuis).
 */
export type FillRow<I extends ShoppingItem = ShoppingItem> = {
  item: I;
  key: string;
  choice: DriveChoice | null;
  status: 'ready' | 'fallback' | 'none';
  count: DriveCount | null;
  line: DriveBasketLine | null;
  changed: boolean;
};

/** Lignes du panier en cours chez l'enseigne choisie (aucune si le panier est celui d'une autre enseigne). */
export const basketLines = (view: DriveView): DriveBasketLine[] =>
  view.settings.enseigne && view.basket?.enseigne === view.settings.enseigne ? view.basket.lines : [];

/** Articles à acheter (non cochés) avec leur produit et leur ligne du panier, dans l'ordre de la liste. */
export function fillRows<I extends ShoppingItem>(items: readonly I[], view: DriveView): FillRow<I>[] {
  const enseigne = view.settings.enseigne;
  if (!enseigne) return [];
  const lines = basketLines(view);
  return items
    .filter((item) => !item.done)
    .map((item) => {
      const key = itemKey(item);
      const choice = choiceFor(view.choices, key, enseigne);
      const product = choice?.preferred ?? null;
      const count = product ? driveCount(item, product) : null;
      const line = lines.find((l) => l.itemId === item.id) ?? null;
      const changed = line !== null && ((line.product?.id ?? null) !== (product?.id ?? null) || (count !== null && line.count !== count.count));
      const status = product ? 'ready' : choice?.fallback.length ? 'fallback' : 'none';
      return { item, key, choice, status, count, line, changed };
    });
}

/** Ce qu'on met au panier pour un article, à partir de son produit retenu (sans produit : 1 paquet). */
export function basketLine(item: ShoppingItem, choice: DriveChoice | null): Pick<DriveBasketLine, 'itemId' | 'key' | 'label' | 'product' | 'count' | 'per'> {
  const product = choice?.preferred ?? null;
  const count = product ? driveCount(item, product) : { count: 1, per: null };
  return {
    itemId: item.id,
    key: itemKey(item),
    label: itemName(item),
    product: product ? { id: product.id, name: product.name, url: product.url } : null,
    count: count.count,
    per: count.per,
  };
}

/**
 * Récapitulatif du panier : ce qui part au drive (cochés), ce qui reste à mettre au panier (produit retenu, pas
 * coché), ce qui s'achète ailleurs (pas coché et sans produit retenu : aucun produit, ou seulement des secours), et le
 * nombre de paquets au panier.
 */
export function driveRecap<I extends ShoppingItem>(rows: readonly FillRow<I>[]) {
  const drive = rows.filter((r) => r.line !== null);
  const prices = drive.map((r) => linePrice(r));
  return {
    drive,
    toFill: rows.filter((r) => r.line === null && r.status === 'ready'),
    elsewhere: rows.filter((r) => r.line === null && r.status !== 'ready'),
    packs: drive.reduce((sum, r) => sum + (r.line?.count ?? 0), 0),
    /** Total indicatif des lignes au panier dont le prix a été vu par l'extension, et combien n'en ont pas. */
    total: Math.round(prices.reduce<number>((sum, p) => sum + (p ?? 0), 0) * 100) / 100,
    unpriced: prices.filter((p) => p === null).length,
  };
}

/** Prix d'un paquet du produit d'une ligne (retenu ou secours), s'il a été vu par l'extension. */
export function packPrice(row: Pick<FillRow, 'choice'>, productId: string | null): DrivePrice | null {
  if (!productId || !row.choice) return null;
  return [row.choice.preferred, ...row.choice.fallback].find((p) => p?.id === productId)?.price ?? null;
}

/** Prix d'une ligne au panier : prix d'un paquet × paquets ; null si le prix n'a pas été vu. */
export function linePrice(row: Pick<FillRow, 'choice' | 'line'>): number | null {
  const price = row.line ? packPrice(row, row.line.product?.id ?? null) : null;
  return price && row.line ? Math.round(price.value * row.line.count * 100) / 100 : null;
}

/**
 * EAN du produit comparé à ceux du stock pour cet article : `match` (même produit), `other` (le stock a d'autres
 * produits pour cet article), null (rien à comparer).
 */
export function eanCheck(ean: string | null, hints: readonly Pick<DriveStockHint, 'ean'>[]): 'match' | 'other' | null {
  if (!ean || hints.length === 0) return null;
  return hints.some((h) => h.ean === ean) ? 'match' : 'other';
}
