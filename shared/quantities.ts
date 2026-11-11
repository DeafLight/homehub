// Quantités d'un même ingrédient venues de plusieurs recettes (ou d'un paquet du stock), rangées par grandeur : masse
// (en grammes), volume (en millilitres), cuillères (en cuillères à café), et chaque autre unité à part (pièces,
// gousses, sachets…). Ce qui se convertit s'additionne (g et kg, cl et l, c. à s. et c. à c.) ; le reste est montré
// côte à côte (« 2 + 100 g »), jamais additionné. Partagé entre le serveur (liste de courses) et le front.
import { formatQuantity, type Unit, unitLabel } from './ingredients.ts';

/** Grandeur → quantité dans son unité de base (g, ml, c. à c., ou l'unité elle-même). */
export type Quantities = Partial<Record<string, number>>;

const BASES: Partial<Record<Unit, [string, number]>> = {
  mg: ['masse', 0.001],
  g: ['masse', 1],
  kg: ['masse', 1000],
  ml: ['volume', 1],
  cl: ['volume', 10],
  dl: ['volume', 100],
  l: ['volume', 1000],
  cc: ['cuillere', 1],
  cs: ['cuillere', 3],
};

/** Grandeur d'une unité et son facteur vers l'unité de base (« kg » → masse, 1000). */
export function dimensionOf(unit: Unit): { dimension: string; factor: number } {
  const base = BASES[unit];
  return base ? { dimension: base[0], factor: base[1] } : { dimension: unit, factor: 1 };
}

/** Une quantité dans son unité, rangée par grandeur. */
export function quantitiesOf(quantity: number, unit: Unit): Quantities {
  const { dimension, factor } = dimensionOf(unit);
  return { [dimension]: quantity * factor };
}

const EPSILON = 1e-9;
const clean = (q: Quantities): Quantities =>
  Object.fromEntries(Object.entries(q).filter((e): e is [string, number] => e[1] !== undefined && e[1] > EPSILON));

export function addQuantities(a: Quantities, b: Quantities): Quantities {
  const sum: Quantities = { ...a };
  for (const [dimension, value] of Object.entries(b)) if (value) sum[dimension] = (sum[dimension] ?? 0) + value;
  return clean(sum);
}

export function scaleQuantities(q: Quantities, factor: number): Quantities {
  return clean(Object.fromEntries(Object.entries(q).map(([d, v]) => [d, (v ?? 0) * factor])));
}

export const isEmpty = (q: Quantities) => Object.keys(clean(q)).length === 0;

/**
 * Ce qui manque encore de `need` quand on a déjà `have` : grandeur par grandeur. `uncertain` : une partie de ce
 * qu'on a ne se compare à rien de ce qu'il faut (« 1 paquet » pour « 150 g ») ; on le signale sans trancher, et ce
 * qu'il faut dans ces grandeurs reste dû.
 */
export function subtractQuantities(need: Quantities, have: Quantities): { rest: Quantities; uncertain: boolean } {
  const rest: Quantities = {};
  for (const [dimension, value] of Object.entries(clean(need))) {
    rest[dimension] = Math.max(0, (value ?? 0) - (have[dimension] ?? 0));
  }
  // Il reste à acheter dans une grandeur, et il reste de ce qu'on a dans une autre : impossible de comparer.
  const left = Object.entries(clean(have)).filter(([d, v]) => (v ?? 0) - (need[d] ?? 0) > EPSILON).map(([d]) => d);
  const missing = Object.keys(clean(rest));
  return { rest: clean(rest), uncertain: missing.length > 0 && left.some((d) => !missing.includes(d)) };
}

/** Ordre d'affichage : pièces, masse, volume, cuillères, puis les autres unités. */
const ORDER = ['piece', 'masse', 'volume', 'cuillere'];
const rank = (dimension: string) => (ORDER.includes(dimension) ? ORDER.indexOf(dimension) : ORDER.length);

/** Une grandeur dans l'unité la plus lisible : 1,2 kg, 75 cl, 2 c. à s., 3 gousses. */
function formatOne(dimension: string, value: number): string {
  if (dimension === 'masse') return value >= 1000 ? `${formatQuantity(value / 1000, 'kg')} kg` : `${formatQuantity(value, 'g')} g`;
  if (dimension === 'volume') {
    if (value >= 1000) return `${formatQuantity(value / 1000, 'l')} l`;
    if (value >= 100 && value % 10 === 0) return `${formatQuantity(value / 10, 'cl')} cl`;
    return `${formatQuantity(value, 'ml')} ml`;
  }
  if (dimension === 'cuillere') {
    // Trois c. à c. font une c. à s. : au-delà, en c. à s. (« 1 ⅓ c. à s. » plutôt que « 4 c. à c. »).
    return value >= 3 ? `${formatQuantity(value / 3, 'cs')} c. à s.` : `${formatQuantity(value, 'cc')} c. à c.`;
  }
  const unit = dimension as Unit;
  if (unit === 'piece') return formatQuantity(value, 'piece');
  return `${formatQuantity(value, unit)} ${unitLabel(unit, value)}`;
}

/** « 2 + 100 g », « 1,2 kg », « 3 gousses » ; vide sans quantité. */
export function formatQuantities(q: Quantities): string {
  return Object.entries(clean(q))
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([dimension, value]) => formatOne(dimension, value ?? 0))
    .join(' + ');
}

// --- Contenance d'un paquet du stock (« 2 x 75 g », « 1,5 L », « 6 × 1 L », « x12 ») ---

const PACKAGE_UNITS: [RegExp, Unit][] = [
  [/^(kg|kilos?)$/iu, 'kg'],
  [/^(g|gr|grammes?)$/iu, 'g'],
  [/^mg$/iu, 'mg'],
  [/^(l|litres?)$/iu, 'l'],
  [/^cl$/iu, 'cl'],
  [/^dl$/iu, 'dl'],
  [/^ml$/iu, 'ml'],
];

export type Amount = { quantity: number; unit: Unit };

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Contenance d'un paquet telle qu'écrite sur l'étiquette : « 2 x 75 g » → 150 g, « 1,5 L » → 1,5 l, « 6 œufs » ou
 * « x12 » → 6 ou 12 pièces. null si rien de lisible.
 */
export function parsePackage(text: string | null): Amount | null {
  if (!text) return null;
  const value = text.toLowerCase().replace(/,/gu, '.').replace(/\s+/gu, ' ').trim();
  const multi = /^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*([a-zé]+)\.?$/u.exec(value);
  const single = /^(\d+(?:\.\d+)?)\s*([a-zéœ]+)\.?(?:\s.*)?$/u.exec(value);
  const count = /^(?:[x×]\s*(\d+)|(\d+)\s*(?:pi[eè]ces?|pcs?|unit[ée]s?|œufs?|oeufs?|tranches?|sachets?)?)$/u.exec(value);
  if (multi) {
    const unit = PACKAGE_UNITS.find(([re]) => re.test(multi[3]))?.[1];
    if (unit) return { quantity: round(Number(multi[1]) * Number(multi[2])), unit };
  }
  if (single) {
    const unit = PACKAGE_UNITS.find(([re]) => re.test(single[2]))?.[1];
    if (unit) return { quantity: Number(single[1]), unit };
  }
  if (count) {
    const n = Number(count[1] ?? count[2]);
    if (n > 0) return { quantity: n, unit: 'piece' };
  }
  return null;
}

/** « 150 g », « 1 l », « 6 » ; pour une contenance de paquet. */
export const formatAmount = ({ quantity, unit }: Amount) => formatQuantities(quantitiesOf(quantity, unit));
