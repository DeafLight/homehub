// Affichage du menu de la semaine (tablette et téléphone) : semaines et jours en toutes lettres, recettes rangées
// par jour, courses rangées par rayon avec ce qu'on a déjà (et ce qui est à vérifier au placard), les frais d'un
// repas tardif « À acheter plus tard » rangés par jour d'achat, et la liste de courses rangée par rayon elle aussi. Les calculs (agrégation, stock, paquet peut-être entamé, arrondi au paquet)
// sont faits par le serveur avec shared/menu.ts ; ici, seulement la présentation.
import { formatPacks, labelKey, type LaterPart, type MenuViewEntry, type PlanLine, sourceLabel, weekDays } from '../../../shared/menu.ts';
import { guessAisle, type Unit } from '../../../shared/ingredients.ts';
import { formatQuantities, isEmpty } from '../../../shared/quantities.ts';
import type { ShoppingItem, ShoppingLater } from '../../../shared/types.ts';
import { parseDay } from './lists.ts';

const dayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric' });
const shortFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** « Cette semaine », « Semaine prochaine », « Semaine dernière », sinon « Semaine du 23 nov. ». */
export function weekLabel(week: string, current: string): string {
  const diff = Math.round((parseDay(week).getTime() - parseDay(current).getTime()) / (7 * 86_400_000));
  if (diff === 0) return 'Cette semaine';
  if (diff === 1) return 'Semaine prochaine';
  if (diff === -1) return 'Semaine dernière';
  return `Semaine du ${shortFormat.format(parseDay(week))}`;
}

/** « du 9 au 15 nov. », « du 26 oct. au 1 nov. ». */
export function weekRange(week: string): string {
  const days = weekDays(week);
  const [first, last] = [parseDay(days[0]), parseDay(days[6])];
  const start = first.getMonth() === last.getMonth() ? String(first.getDate()) : shortFormat.format(first);
  return `du ${start} au ${shortFormat.format(last)}`;
}

/** « Mercredi 11 ». */
export const dayLabel = (day: string) => capitalize(dayFormat.format(parseDay(day)));

/** « 4 pers. », « 12 galettes ». */
export const peopleLabel = (entry: Pick<MenuViewEntry, 'people' | 'servingsUnit'>) => `${entry.people} ${entry.servingsUnit ?? 'pers.'}`;

export type DayGroup = { day: string | null; label: string; entries: MenuViewEntry[] };

/**
 * Recettes de la semaine par jour (les sept jours, dans l'ordre), puis celles sans jour (« Cette semaine »).
 * `all` faux : seulement les groupes qui ont une recette (téléphone).
 */
export function entriesByDay(week: string, entries: readonly MenuViewEntry[], all = true): DayGroup[] {
  const groups: DayGroup[] = [
    ...weekDays(week).map((day) => ({ day, label: dayLabel(day), entries: entries.filter((e) => e.day === day) })),
    { day: null, label: 'Dans la semaine, sans jour', entries: entries.filter((e) => e.day === null || !weekDays(week).includes(e.day)) },
  ];
  return all ? groups : groups.filter((g) => g.entries.length > 0);
}

/** Ordre des rayons du magasin ; un article sans rayon connu va dans « Autres », à la fin. */
export const AISLE_ORDER = ['Fruits et légumes', 'Boucherie', 'Poissonnerie', 'Crèmerie', 'Boulangerie', 'Épices et condiments', 'Épicerie', 'Surgelés'];
export const OTHER_AISLE = 'Autres';
const aisleRank = (aisle: string) => (AISLE_ORDER.includes(aisle) ? AISLE_ORDER.indexOf(aisle) : AISLE_ORDER.length);

export type AisleGroup<T> = { aisle: string; items: T[] };

/** Range par rayon, dans l'ordre du magasin, en gardant l'ordre d'arrivée dans chaque rayon. */
export function byAisle<T>(items: readonly T[], aisleOf: (item: T) => string | null): AisleGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const aisle = aisleOf(item) ?? OTHER_AISLE;
    groups.set(aisle, [...(groups.get(aisle) ?? []), item]);
  }
  return [...groups.entries()].sort(([a], [b]) => aisleRank(a) - aisleRank(b)).map(([aisle, list]) => ({ aisle, items: list }));
}

/** Rayon d'un article de la liste : celui du menu, sinon deviné d'après son libellé (« Yaourts nature » → Crèmerie). */
export const itemAisle = (item: Pick<ShoppingItem, 'label' | 'menu'>) => item.menu?.aisle ?? guessAisle(labelKey(item.label));

/** Part fraîche qui attend, avec sa ligne. */
export type LaterRow = { line: PlanLine; part: LaterPart };

/**
 * Courses du menu : ce qui est à vérifier au placard (encore dans les courses tant qu'on n'a pas décidé), ce qu'il
 * reste à acheter, par rayon, les frais à acheter plus tard (par jour d'achat), puis ce qu'on a déjà (ou qui est sur
 * la liste à la main).
 */
export function planGroups(plan: readonly PlanLine[]): { toCheck: PlanLine[]; toBuy: AisleGroup<PlanLine>[]; later: LaterRow[]; covered: PlanLine[] } {
  const toCheck = (l: PlanLine) => l.status === 'buy' && l.check === 'ask';
  return {
    toCheck: plan.filter(toCheck),
    toBuy: byAisle(plan.filter((l) => l.status === 'buy' && !toCheck(l)), (l) => l.aisle),
    later: plan.flatMap((line) => line.later.map((part) => ({ line, part }))).sort((a, b) => a.part.day.localeCompare(b.part.day)),
    covered: plan.filter((l) => l.status !== 'buy' && l.status !== 'later'),
  };
}

/** Quantité d'une part qui attend : « 20 cl », « 400 g (2 × 200 g) », rien pour « persil ». */
export function laterAmount(part: LaterPart): string {
  const amount = formatQuantities(part.buy);
  return part.packs && amount ? `${amount} (${formatPacks(part.packs)})` : amount;
}

/** Jour d'achat en clair : « Demain », sinon « Jeudi 19 ». */
export const buyDayLabel = (day: string, today: string) => {
  const tomorrow = parseDay(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return parseDay(day).getTime() === tomorrow.getTime() ? 'Demain' : dayLabel(day);
};

export type LaterGroup = { day: string; items: ShoppingLater[] };

/** Frais à acheter plus tard de la liste de courses, par jour d'achat (dans l'ordre). */
export function laterByDay(items: readonly ShoppingLater[]): LaterGroup[] {
  const groups = new Map<string, ShoppingLater[]>();
  for (const item of [...items].sort((a, b) => a.day.localeCompare(b.day))) groups.set(item.day, [...(groups.get(item.day) ?? []), item]);
  return [...groups.entries()].map(([day, list]) => ({ day, items: list }));
}

const products = (names: string[]) => names.join(', ');

/**
 * Quantité d'une ligne : ce qu'il reste à acheter (« 100 g », « 250 g (2 × 200 g) » quand un produit est relié), ou
 * ce qu'il faut en tout (« 600 g »).
 */
export function lineAmount(line: PlanLine): string {
  if (line.status !== 'buy') return formatQuantities(line.quantities);
  const amount = formatQuantities(line.buy);
  return line.packs && amount ? `${amount} (${formatPacks(line.packs)})` : amount;
}

/** Ce qu'on a déjà pour une ligne, en clair ; null : rien. */
export function lineStatus(line: PlanLine): string | null {
  switch (line.status) {
    case 'pantry':
      return 'Placard';
    case 'have':
      return 'J’en ai déjà';
    case 'manual':
      return 'Déjà sur la liste';
    case 'bought':
      return 'Acheté';
    case 'later':
      return 'À acheter plus tard';
    case 'stock':
      if (line.check === 'enough') return `Assez au placard (${products(line.stock?.opened ?? [])})`;
      return `En stock (${products(line.stock?.products ?? [])})`;
    case 'buy': {
      if (line.check === 'ask') return `Paquet peut-être entamé (${products(line.stock?.opened ?? [])})`;
      if (line.check === 'needed') return 'Vérifié : il en faut';
      if (line.advanced && !line.stock && !line.bought) return 'Avancé : à acheter maintenant';
      if (!line.stock) return line.bought ? `Déjà acheté : ${formatQuantities(line.bought.quantities)}` : null;
      if (line.stock.enough === null) return `En stock, à vérifier (${products(line.stock.products)})`;
      if (isEmpty(line.stock.quantities)) return `En stock, pas assez (${products(line.stock.products)})`;
      return `En stock : ${formatQuantities(line.stock.quantities)} (${products(line.stock.products)})`;
    }

  }
}

/** Recettes d'où vient une ligne : « Mijoté ×2, Pâtes au thon ». */
export const lineSources = (line: Pick<PlanLine, 'sources'>) => line.sources.map(sourceLabel).join(', ');

/** Unités proposées pour la contenance d'un produit relié. */
export const PACKAGE_UNITS: { unit: Unit; label: string }[] = [
  { unit: 'g', label: 'g' },
  { unit: 'kg', label: 'kg' },
  { unit: 'ml', label: 'ml' },
  { unit: 'cl', label: 'cl' },
  { unit: 'l', label: 'l' },
  { unit: 'piece', label: 'pièces' },
];

/** Placards saisis en une ligne (« sel, poivre, huile ») : nettoyés, sans doublon. */
export function parsePantry(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,;\n]/u)
    .map((s) => s.trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
