// Libellés du stock (logique pure, testée) : fiche d'un produit, provenance, quantités, saisie d'un produit sans
// code-barres, filtre « À consommer » (une ligne par lot qui arrive à date).
import { isLooseCode } from '../../../shared/barcode.ts';
import { toConsume } from '../../../shared/expiry.ts';
import { formatLoose, isCounted, looseAmount } from '../../../shared/loose.ts';
import type { Author, Container, LotView, Product, ProductInfo, StockEntry, StockMark, StockMovement } from '../../../shared/types.ts';
import { estimateLabel } from '../../../shared/cook.ts';
import { dayDiff, formatTime } from './format.ts';

const BASE_NAMES: Record<string, string> = {
  'open-food-facts': 'Open Food Facts',
  'open-beauty-facts': 'Open Beauty Facts',
  'open-products-facts': 'Open Products Facts',
};

export const baseName = (base: string | null) => (base ? (BASE_NAMES[base] ?? base) : 'la base');

/** « Carrefour Kids · 4 x 90 g », ou vide. */
export const productDetail = (info: Pick<ProductInfo, 'brand' | 'quantity'>) => [info.brand, info.quantity].filter(Boolean).join(' · ');

const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** D'où vient la version en vigueur : « Lu dans Open Food Facts le 5 novembre 2026 », « Corrigé à la main le … ». */
export function provenance(product: Product): string {
  const { current, versionCount } = product;
  if (isLooseCode(product.code)) return `Ajouté sans code-barres le ${day(current.from)}${versionCount > 1 ? ` · ${versionCount} versions` : ''}`;
  const what = current.source === 'base' ? `Lu dans ${baseName(current.base)}` : versionCount > 1 ? 'Corrigé à la main' : 'Saisi à la main';
  return `${what} le ${day(current.from)}${versionCount > 1 ? ` · ${versionCount} versions` : ''}`;
}

export type InfoDiff = { label: string; mine: string; theirs: string }[];

/** Champs qui diffèrent entre notre fiche et celle de la base (nom, marque, contenance). */
export function infoDiff(mine: ProductInfo, theirs: ProductInfo): InfoDiff {
  const fields: [keyof ProductInfo, string][] = [
    ['name', 'Nom'],
    ['brand', 'Marque'],
    ['quantity', 'Contenance'],
  ];
  return fields
    .filter(([key]) => (mine[key] ?? '') !== (theirs[key] ?? ''))
    .map(([key, label]) => ({ label, mine: mine[key] ?? '—', theirs: theirs[key] ?? '—' }));
}

/** « 3 en stock », « Épuisé ». */
/** « 2 en stock », « 2 en stock · entamé, il en reste ½ » (part notée en cuisinant), « Épuisé ». */
export const stockText = (quantity: number, opened: number | null = null) =>
  quantity > 0 ? `${quantity} en stock${opened !== null ? ` · entamé, il en reste ${estimateLabel(opened)}` : ''}` : 'Épuisé';

const shortDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const shortDayYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** Moment d'un scan : « aujourd’hui à 15:42 », « hier à 09:05 », « jeu. 5 nov. à 07:35 », « 3 mars 2025 à 18:10 ». */
export function scanMoment(iso: string, now: Date): string {
  const date = new Date(iso);
  const diff = dayDiff(date, now);
  const day =
    diff === 0 ? 'aujourd’hui'
    : diff === 1 ? 'hier'
    : date.getFullYear() === now.getFullYear() ? shortDay.format(date)
    : shortDayYear.format(date);
  return `${day} à ${formatTime(date)}`;
}

type NameOf = (ownerId: string | null) => string | null;

/** Qui a scanné : « Léa · téléphone », « Sam · tablette », « anonyme · tablette » (personne de reconnu). */
export function scannerLabel(by: Author, nameOf: NameOf): string {
  return `${nameOf(by.ownerId) ?? 'anonyme'} · ${by.via === 'phone' ? 'téléphone' : 'tablette'}`;
}

/** « aujourd’hui à 15:42 · Léa · téléphone » */
export const markLine = (mark: StockMark, now: Date, nameOf: NameOf) => `${scanMoment(mark.at, now)} · ${scannerLabel(mark.by, nameOf)}`;

/**
 * Ligne d'un produit dans le stock. En stock : dernière entrée et dernière sortie, « Rangé hier à 18:20 (Léa) · sorti
 * aujourd’hui à 07:35 (anonyme) ». Épuisé : seulement quand et par qui, « Épuisé aujourd’hui à 07:35 (anonyme) » ; rien
 * si la dernière sortie précède la dernière entrée (mis à zéro à la main : ce n'est pas elle qui l'a épuisé).
 */
export function lastMarksLine(entry: { quantity: number; lastIn: StockMark | null; lastOut: StockMark | null }, now: Date, nameOf: NameOf): string {
  const part = (label: string, mark: StockMark | null) => mark && `${label} ${scanMoment(mark.at, now)} (${nameOf(mark.by.ownerId) ?? 'anonyme'})`;
  if (entry.quantity === 0) {
    const emptied = entry.lastOut && (!entry.lastIn || entry.lastOut.at >= entry.lastIn.at);
    return emptied ? (part('Épuisé', entry.lastOut) as string) : '';
  }
  const parts = [part('rangé', entry.lastIn), part('sorti', entry.lastOut)].filter(Boolean) as string[];
  if (!parts.length) return '';
  const line = parts.join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * Ce qu'a été un mouvement : « Rangé (+ 2) », « Jeté », « Jeté · périmé », « Transvasé », « Inventaire : 3 »,
 * « Contenant vidé », « Date changée » ; un décompte « J'ai cuisiné » : « Cuisiné : Pâtes au thon (− 2) »,
 * « Cuisiné : Gratin · il en reste ½ ».
 */
export function movementLabel(
  m: Pick<StockMovement, 'kind' | 'count' | 'forgotten'> & Partial<Pick<StockMovement, 'reason' | 'opened' | 'expired'>>,
): string {
  const left = m.opened !== null && m.opened !== undefined ? ` · il en reste ${estimateLabel(m.opened)}` : '';
  if (m.reason) {
    if (m.kind === 'container-empty') return `${m.reason} · contenant vidé`;
    if (m.kind === 'opened') return `${m.reason}${left || ' · entamé'}`;
    if (m.kind === 'out') return `${m.reason}${m.count > 1 ? ` (− ${m.count})` : ''}${left}`;
  }
  switch (m.kind) {
    case 'opened':
      return `Entamé${left}`;

    case 'in':
      // Zéro unité : seule la contenance d'un produit sans code-barres a changé (« il reste 800 g »).
      if (m.count === 0) return 'Quantité changée';
      return m.count > 1 ? `Rangé (+ ${m.count})` : 'Rangé';
    case 'out': {
      const expired = m.expired ? ' · périmé' : '';
      return m.forgotten ? 'Jeté · entrée oubliée' : `${m.count > 1 ? `Jeté (− ${m.count})` : 'Jeté'}${expired}`;
    }
    case 'refill':
      return 'Transvasé';
    case 'adjust':
      return `Inventaire : ${m.count}`;
    case 'container-empty':
      return 'Contenant vidé';
    case 'date':
      return 'Date changée';
  }
}

/** « En stock », « À consommer » (lots qui arrivent à date ou l'ont dépassée), « Épuisés », « Tout ». */
export type StockFilter = 'in' | 'expiring' | 'out' | 'all';

const matches = (product: Product, search: string) => {
  const query = search.trim().toLocaleLowerCase('fr');
  return !query || `${product.current.name} ${product.current.brand ?? ''}`.toLocaleLowerCase('fr').includes(query);
};

/** Produits à afficher : en stock, épuisés ou tous, puis ceux dont le nom ou la marque contient la recherche. */
export function filterStock<T extends Pick<StockEntry, 'product' | 'quantity'>>(items: T[], filter: Exclude<StockFilter, 'expiring'>, search: string): T[] {
  const base = filter === 'in' ? items.filter((i) => i.quantity > 0) : filter === 'out' ? items.filter((i) => i.quantity === 0) : items;
  return base.filter((i) => matches(i.product, search));
}

/**
 * Ligne de la liste : un produit et la pastille de date à montrer (le lot le plus urgent) ; dans « À consommer »,
 * une ligne par lot qui arrive à date, avec `part` (« 1 sur 2 ») quand le produit a d'autres unités.
 */
export type StockRow<T> = { entry: T; lot: LotView | null; part: string | null };

/** Lots à consommer, la date la plus proche d'abord. */
export function expiringRows<T extends Pick<StockEntry, 'product' | 'quantity' | 'lots'>>(items: T[], search = ''): StockRow<T>[] {
  const rows: StockRow<T>[] = [];
  for (const entry of items) {
    if (entry.quantity === 0 || !matches(entry.product, search)) continue;
    for (const lot of entry.lots.filter(toConsume)) rows.push({ entry, lot, part: lot.count < entry.quantity ? `${lot.count} sur ${entry.quantity}` : null });
  }
  return rows.sort((a, b) => (a.lot?.due ?? '').localeCompare(b.lot?.due ?? '') || a.entry.product.current.name.localeCompare(b.entry.product.current.name, 'fr'));
}

/** Lignes d'un filtre. */
export function stockRows<T extends Pick<StockEntry, 'product' | 'quantity' | 'lots' | 'expiry'>>(items: T[], filter: StockFilter, search: string): StockRow<T>[] {
  if (filter === 'expiring') return expiringRows(items, search);
  return filterStock(items, filter, search).map((entry) => ({ entry, lot: entry.quantity > 0 ? entry.expiry : null, part: null }));
}

/** Nombre de lignes derrière chaque filtre. */
export function stockCounts(items: Pick<StockEntry, 'product' | 'quantity' | 'lots'>[]): Record<StockFilter, number> {
  const inStock = items.filter((i) => i.quantity > 0).length;
  return { in: inStock, expiring: expiringRows(items).length, out: items.length - inStock, all: items.length };
}

/** Premier lot sans date imprimée d'un produit (« Ajouter une date ») ; null s'ils sont tous datés. */
export const undatedLot = (entry: Pick<StockEntry, 'lots'>) => entry.lots.find((l) => l.date === null) ?? null;

/** « 3 produits jetés (périmés) ce mois-ci », « Rien de jeté périmé ce mois-ci ». */
export const thrownText = (count: number) =>
  count === 0 ? 'Rien de jeté périmé ce mois-ci' : `${count} produit${count > 1 ? 's' : ''} jeté${count > 1 ? 's' : ''} (périmé${count > 1 ? 's' : ''}) ce mois-ci`;

/** « Épuisé » proposé sur chaque produit de la liste, actif dès qu'il en reste un (grisé à 0, comme « − »). */
export const canExhaust = (entry: Pick<StockEntry, 'quantity'>) => entry.quantity > 0;

/**
 * Sous-titre d'un produit de l'inventaire : marque, contenance, rayon ; sinon une invitation à compléter la fiche.
 * Sans code-barres : « Sans code-barres », la quantité pesée (le nombre de pièces est déjà le compte du stock), le rayon.
 */
export function productSubtitle(product: Product): string {
  const { current } = product;
  if (isLooseCode(product.code)) {
    const per = looseAmount(current.quantity, 1);
    const measure = per && !isCounted(per.unit) ? formatLoose(per) : null;
    return ['Sans code-barres', measure, current.category].filter(Boolean).join(' · ');
  }
  return [productDetail(current), current.category].filter(Boolean).join(' · ') || 'Toucher pour compléter la fiche';
}

/**
 * Rayons proposés pour un produit saisi à la main ; les rayons frais (Crèmerie, Boucherie…) donnent une date par
 * défaut (DLC) et une durée sans date (voir shared/expiry.ts).
 */
export const STOCK_CATEGORIES = [
  'Frais',
  'Crèmerie',
  'Boucherie',
  'Poissonnerie',
  'Boulangerie',
  'Fruits et légumes',
  'Épicerie',
  'Boissons',
  'Surgelés',
  'Entretien',
  'Hygiène',
  'Bébé',
  'Animaux',
];

/** Quantité tapée (« 1,2 », « 0.5 », « 6 ») ; null si ce n'est pas un nombre positif. */
export function parseAmount(text: string): number | null {
  const value = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/u.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

/** Ce qu'on a d'un produit sans code-barres (« 1,2 kg », « 6 pièces ») ; null pour un produit à code-barres. */
export function looseText(product: Product, quantity: number): string | null {
  if (!isLooseCode(product.code)) return null;
  const total = looseAmount(product.current.quantity, quantity);
  return total ? formatLoose(total) || 'Épuisé' : null;
}

/** État d'un contenant : ce qu'il contient, ou vide (avec ce qu'il contenait). */
export const containerState = (c: Pick<Container, 'full' | 'productName'>) =>
  c.full ? (c.productName ?? 'Plein') : c.productName ? `Vide (${c.productName})` : 'Vide';
