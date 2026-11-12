// Produits sans code-barres (marché, vrac, fait maison) : une quantité avec son unité (« 1,2 kg » de pommes, « 6 »
// œufs, « 1 botte » de radis) devient, dans le stock, un nombre d'unités et une contenance par unité, comme un paquet
// scanné. Ce qui se compte (pièces, bottes…) : une unité par pièce, contenance « 1 pièce », et le + / − du stock
// marche pièce par pièce. Ce qui se pèse ou se mesure : une seule unité, dont la contenance est la quantité entière.
// Ainsi le menu relie ces produits aux ingrédients par leur contenance, sans rien de particulier. Partagé entre le
// serveur (enregistrement) et le front (formulaire, affichage).
import type { Unit } from './ingredients.ts';
import { type Amount, formatAmount, parsePackage } from './quantities.ts';

/** Nouveau produit sans code-barres (POST /api/stock/loose). */
export type NewLooseProduct = { name: string; category: string | null; amount: number; unit: LooseUnit };

/** Unités proposées, dans l'ordre des boutons. */
export const LOOSE_UNITS = ['kg', 'g', 'l', 'cl', 'piece', 'botte', 'bouquet', 'barquette'] as const satisfies readonly Unit[];
export type LooseUnit = (typeof LOOSE_UNITS)[number];

const MEASURES = new Set<LooseUnit>(['kg', 'g', 'l', 'cl']);

/** Libellé du bouton d'une unité. */
export const LOOSE_UNIT_LABELS: Record<LooseUnit, string> = {
  kg: 'kg',
  g: 'g',
  l: 'l',
  cl: 'cl',
  piece: 'pièces',
  botte: 'bottes',
  bouquet: 'bouquets',
  barquette: 'barquettes',
};

/** Se compte (pièces, bottes…) plutôt que se peser ou se mesurer. */
export const isCounted = (unit: LooseUnit) => !MEASURES.has(unit);

export const isLooseUnit = (unit: string): unit is LooseUnit => (LOOSE_UNITS as readonly string[]).includes(unit);

/** Plus grand compte accepté (comme les entrées du stock), et plus grande mesure (99 999 g…). */
export const LOOSE_MAX_COUNT = 99;
const LOOSE_MAX_MEASURE = 99_999;

/** Quantité acceptable pour cette unité : positive ; entière et 99 au plus pour ce qui se compte. */
export const validLooseAmount = (amount: number, unit: LooseUnit) =>
  Number.isFinite(amount) &&
  amount > 0 &&
  (isCounted(unit) ? Number.isInteger(amount) && amount <= LOOSE_MAX_COUNT : amount <= LOOSE_MAX_MEASURE);

const decimal = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/** Contenance d'une unité du stock (« 1 botte », « 1 pièce », « 1,2 kg »), et combien d'unités. */
export function looseStock(amount: number, unit: LooseUnit): { count: number; quantity: string } {
  if (isCounted(unit)) return { count: amount, quantity: unit === 'piece' ? '1 pièce' : `1 ${unit}` };
  return { count: 1, quantity: `${decimal(amount)} ${unit}` };
}

/** Ce qu'on a en tout : contenance par unité fois le nombre d'unités (« 1,2 kg », « 6 pièces ») ; null si illisible. */
export function looseAmount(quantity: string | null, count: number): { amount: number; unit: LooseUnit } | null {
  const per = parsePackage(quantity);
  if (!per || !isLooseUnit(per.unit)) return null;
  return { amount: Math.round(per.quantity * count * 1000) / 1000, unit: per.unit };
}

/** « 1,2 kg », « 6 pièces », « 1 botte » ; vide pour rien. */
export function formatLoose({ amount, unit }: { amount: number; unit: LooseUnit }): string {
  if (amount <= 0) return '';
  if (unit === 'piece') return `${decimal(amount)} pièce${amount > 1 ? 's' : ''}`;
  return formatAmount({ quantity: amount, unit } satisfies Amount);
}
