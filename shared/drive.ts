// Drive (étape 1) : relier un article de la liste de courses à un produit d'une enseigne, choisi une fois puis retenu.
// Partagé entre le serveur (qui lit la fiche partagée et garde les choix dans drive.json) et le front (qui affiche).
// Rien ne cherche dans le catalogue de l'enseigne : la personne partage ou colle le lien d'une fiche produit, dont on
// tire l'identifiant ; la fiche peut être lue une fois, à sa demande (JSON-LD `Product` : nom, contenance, EAN), et si
// le site refuse, on saisit le nom et la contenance, ou on les reprend d'un produit du stock (par EAN).
//
// Un article est désigné par sa clé : celle de l'ingrédient pour une ligne du menu, celle de son libellé pour un
// produit hors recettes (« Lessive »), comme pour le reste de la liste. Un choix porte un produit retenu et des
// produits de secours, jamais pris d'office (retirer le produit retenu ne promeut pas un secours).
// Une seule enseigne pour l'instant (Courses U) ; chaque enseigne a son adaptateur (hôtes, forme des liens).
import { ingredientKey, parseIngredient } from './ingredients.ts';
import { type Packs, packsFor } from './menu.ts';
import { type Amount, parsePackage } from './quantities.ts';
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

export const DRIVE_LIMITS = { choices: 500, fallback: 3, name: 120, brand: 80, pack: 40, storeName: 80, url: 500 } as const;

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
};

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

/** GET /api/drive. */
export type DriveView = { settings: DriveSettings; choices: DriveChoice[] };

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

/**
 * Paquets du produit retenu pour une ligne du menu, avec l'arrondi au paquet de la liste (packsFor) : « 2 × 200 g ».
 * null : article hors recettes, contenance inconnue ou grandeurs qui ne se comparent pas.
 */
export function drivePacks(item: Pick<ShoppingItem, 'menu'>, product: Pick<DriveProduct, 'pack'> | null): Packs | null {
  if (!item.menu || !product?.pack) return null;
  return packsFor(item.menu.quantities, [product.pack]);
}

/**
 * EAN du produit comparé à ceux du stock pour cet article : `match` (même produit), `other` (le stock a d'autres
 * produits pour cet article), null (rien à comparer).
 */
export function eanCheck(ean: string | null, hints: readonly Pick<DriveStockHint, 'ean'>[]): 'match' | 'other' | null {
  if (!ean || hints.length === 0) return null;
  return hints.some((h) => h.ean === ean) ? 'match' : 'other';
}
