// Libellés du stock (logique pure, testée) : fiche d'un produit, provenance, quantités.
import type { Product, ProductInfo } from '../../../shared/types.ts';

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
