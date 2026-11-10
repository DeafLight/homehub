// Libellés du stock (logique pure, testée) : fiche d'un produit, provenance, quantités.
import type { Author, Container, Product, ProductInfo, StockEntry, StockMark, StockMovement } from '../../../shared/types.ts';
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
export const stockText = (quantity: number) => (quantity > 0 ? `${quantity} en stock` : 'Épuisé');

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

/** Ce qu'a été un mouvement : « Rangé (+ 2) », « Jeté », « Transvasé », « Inventaire : 3 », « Contenant vidé ». */
export function movementLabel(m: Pick<StockMovement, 'kind' | 'count' | 'forgotten'>): string {
  switch (m.kind) {
    case 'in':
      return m.count > 1 ? `Rangé (+ ${m.count})` : 'Rangé';
    case 'out':
      return m.forgotten ? 'Jeté · entrée oubliée' : m.count > 1 ? `Jeté (− ${m.count})` : 'Jeté';
    case 'refill':
      return 'Transvasé';
    case 'adjust':
      return `Inventaire : ${m.count}`;
    case 'container-empty':
      return 'Contenant vidé';
  }
}

export type StockFilter = 'in' | 'out' | 'all';

/** Produits à afficher : en stock, épuisés ou tous, puis ceux dont le nom ou la marque contient la recherche. */
export function filterStock<T extends Pick<StockEntry, 'product' | 'quantity'>>(items: T[], filter: StockFilter, search: string): T[] {
  const base = filter === 'in' ? items.filter((i) => i.quantity > 0) : filter === 'out' ? items.filter((i) => i.quantity === 0) : items;
  const query = search.trim().toLocaleLowerCase('fr');
  return query ? base.filter((i) => `${i.product.current.name} ${i.product.current.brand ?? ''}`.toLocaleLowerCase('fr').includes(query)) : base;
}

/** Nombre de produits derrière chaque filtre. */
export function stockCounts(items: Pick<StockEntry, 'quantity'>[]): Record<StockFilter, number> {
  const inStock = items.filter((i) => i.quantity > 0).length;
  return { in: inStock, out: items.length - inStock, all: items.length };
}

/** Sous-titre d'un produit de l'inventaire : marque, contenance, rayon ; sinon une invitation à compléter la fiche. */
export const productSubtitle = (product: Product) => [productDetail(product.current), product.current.category].filter(Boolean).join(' · ') || 'Toucher pour compléter la fiche';

/** État d'un contenant : ce qu'il contient, ou vide (avec ce qu'il contenait). */
export const containerState = (c: Pick<Container, 'full' | 'productName'>) =>
  c.full ? (c.productName ?? 'Plein') : c.productName ? `Vide (${c.productName})` : 'Vide';
