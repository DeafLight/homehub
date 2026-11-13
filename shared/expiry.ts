// Dates de péremption du stock, partagées entre le serveur (qui range, sort et résume) et le front (qui affiche) :
// lots datés, date estimée d'après le rayon, niveau d'un lot (passée, urgente, bientôt), ordre de sortie (la date la
// plus proche d'abord), année devinée d'une date tapée « jour et mois », libellés, carte « À consommer » de l'accueil,
// et liens avec le menu (recettes « À cuisiner d'abord », DLC qui finit avant un repas).
//
// Règles :
// - Une DLC passée est rouge et va sur l'accueil ; une DDM passée est grise et n'y va pas ; une date estimée n'est
//   jamais rouge ni urgente (« à vérifier » seulement, sur la page Stock).
// - Un lot « Encore bon » garde sa date mais ne déclenche plus rien.
// - Le jour change à minuit, heure locale (dates AAAA-MM-JJ comparées comme des jours, sans heure).
import { localDay } from './dates.ts';
import type { DateKind, ExpiringItem, ExpiryLevel, ExpirySettings, LotView, Product, StockLot } from './types.ts';

/** Seuils et durées par défaut (décisions du 13/11/2026). */
export const DEFAULT_EXPIRY: ExpirySettings = {
  soonDlcDays: 5,
  urgentDlcDays: 2,
  soonDdmDays: 30,
  defaults: { Boulangerie: 2, Poissonnerie: 2, Boucherie: 3, 'Fruits et légumes': 5, Frais: 5, Crèmerie: 7 },
};

/** Bornes des réglages (jours). */
export const EXPIRY_LIMITS = { threshold: 60, keep: 365 } as const;

/** Rayons du stock dont les produits ont l'habitude d'une date : « Date ? » au scan, DLC par défaut. */
export const FRESH_CATEGORIES = ['Frais', 'Crèmerie', 'Boucherie', 'Poissonnerie', 'Boulangerie', 'Fruits et légumes'] as const;

export const isFreshCategory = (category: string | null) => category !== null && (FRESH_CATEGORIES as readonly string[]).includes(category);

type DatedProduct = Pick<Product, 'dateKind' | 'askDate' | 'keepDays'> & { current: { category: string | null } };

/** Type de date d'un produit : choisi une fois, sinon DLC pour un rayon frais, DDM pour le reste. */
export const productDateKind = (product: DatedProduct): DateKind => product.dateKind ?? (isFreshCategory(product.current.category) ? 'dlc' : 'ddm');

/** « Date ? » au scan : pas pour un produit marqué « Ne plus demander » ; oui s'il a déjà été daté ou s'il est frais. */
export const asksDate = (product: DatedProduct) => product.askDate ?? isFreshCategory(product.current.category);

/** Jours que tient un produit sans date : sa propre durée, sinon celle de son rayon, sinon rien (pas d'estimation). */
export function keepDaysOf(product: DatedProduct, settings: ExpirySettings): number | null {
  if (product.keepDays) return product.keepDays;
  const category = product.current.category;
  return category ? (settings.defaults[category] ?? null) : null;
}

// --- Jours (AAAA-MM-JJ) ---

const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
const utc = (day: string) => {
  const [y, m, d] = parts(day);
  return Date.UTC(y, m - 1, d);
};

/** Jours de `from` à `to` (négatif si `to` est avant). */
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000);

/** Jour décalé de `count` jours. */
export function shiftDay(day: string, count: number): string {
  const date = new Date(utc(day) + count * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Une date bien écrite (AAAA-MM-JJ) qui existe. */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return false;
  return shiftDay(text, 0) === text;
}

/** Dernier jour d'un mois (« 03/2027 » imprimé sur une DDM : rangée au 31 mars 2027). */
export function monthEnd(month: number, year: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/**
 * Année d'une date tapée « jour et mois » : la prochaine occurrence de ce jour (aujourd'hui compris), sauf si elle est
 * à plus de 10 mois : c'est alors une date de cette année, déjà passée. null : jour impossible (31/02).
 */
export function guessDay(day: number, month: number, today: string): string | null {
  const [year] = parts(today);
  const make = (y: number) => {
    const text = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return isDay(text) ? text : null;
  };
  const thisYear = make(year);
  if (thisYear && thisYear >= today) return thisYear;
  const next = make(year + 1);
  if (!next) return thisYear;
  // Plus de 10 mois devant (≈ 304 jours) : une date passée de cette année, pas l'an prochain.
  if (daysBetween(today, next) > 304) return thisYear;
  return next;
}

// --- Lots ---

/** Lots d'un produit tels que gardés ; un ancien fichier sans lots : un seul lot sans date de toute la quantité. */
export function storedLots(entry: { quantity: number; updatedAt: string; lots?: StockLot[] }, legacyId: string): StockLot[] {
  if (entry.lots) return entry.lots;
  return entry.quantity > 0 ? [{ id: legacyId, count: entry.quantity, in: entry.updatedAt, date: null, kind: null, dismissed: false }] : [];
}

/** Ordre de sortie : la date imprimée la plus proche d'abord, les lots sans date en dernier ; à égalité, le plus ancien entré. */
export function fefo<T extends Pick<StockLot, 'date' | 'in'>>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date.localeCompare(b.date);
    }
    return a.in.localeCompare(b.in);
  });
}

/** Niveau d'une date aujourd'hui, selon son type et les seuils ; un lot « Encore bon » n'alerte plus. */
export function levelOf(due: string | null, kind: DateKind, estimated: boolean, dismissed: boolean, today: string, settings: ExpirySettings): ExpiryLevel {
  if (due === null) return 'none';
  const left = daysBetween(today, due);
  if (dismissed) return 'later';
  if (left < 0) return 'passed';
  // Une estimée n'est jamais urgente : « à vérifier » dans les 2 jours.
  if (estimated) return left <= settings.urgentDlcDays ? 'soon' : 'later';
  if (kind === 'dlc') return left <= settings.urgentDlcDays ? 'urgent' : left <= settings.soonDlcDays ? 'soon' : 'later';
  return left <= settings.soonDdmDays ? 'soon' : 'later';
}

/** Un lot vu aujourd'hui : date imprimée ou estimée, type effectif, niveau. */
export function viewLot(lot: StockLot, product: DatedProduct, settings: ExpirySettings, today: string): LotView {
  const dateKind = lot.kind ?? productDateKind(product);
  let due = lot.date;
  let estimated = false;
  if (due === null) {
    const keep = keepDaysOf(product, settings);
    if (keep !== null) {
      due = shiftDay(localDay(new Date(lot.in)), keep);
      estimated = true;
    }
  }
  return { ...lot, due, estimated, dateKind, level: levelOf(due, dateKind, estimated, lot.dismissed, today, settings) };
}

const SEVERITY: Record<ExpiryLevel, number> = { passed: 0, urgent: 1, soon: 2, later: 3, none: 4 };

/** Lots d'un produit vus aujourd'hui, dans l'ordre de sortie. */
export const viewLots = (lots: readonly StockLot[], product: DatedProduct, settings: ExpirySettings, today: string) =>
  fefo(lots).map((lot) => viewLot(lot, product, settings, today));

/** Le lot le plus urgent (niveau le plus grave, puis date la plus proche) ; null s'il n'y a aucune date. */
export function worstLot(lots: readonly LotView[]): LotView | null {
  let worst: LotView | null = null;
  for (const lot of lots) {
    if (lot.due === null) continue;
    if (!worst || SEVERITY[lot.level] < SEVERITY[worst.level] || (lot.level === worst.level && lot.due < (worst.due as string))) worst = lot;
  }
  return worst;
}

/** Filtre « À consommer » : un lot passé (DLC en rouge, le reste en gris), urgent ou bientôt. */
export const toConsume = (lot: Pick<LotView, 'level'>) => lot.level === 'passed' || lot.level === 'urgent' || lot.level === 'soon';

/** Lot dont la date imprimée est passée (et pas « Encore bon ») : une unité qui en sort est « jetée (périmée) ». */
export const isExpired = (lot: Pick<LotView, 'level' | 'estimated'>) => lot.level === 'passed' && !lot.estimated;

/**
 * « Lequel ? » au scanner : plusieurs lots de dates différentes dont le premier à sortir est passé. On sort d'office
 * le plus proche (le périmé) ; la fenêtre laisse choisir l'autre (on a fini le bon).
 */
export function whichLot(lots: readonly LotView[]): { expired: LotView; other: LotView } | null {
  const [first] = lots;
  if (!first || !isExpired(first)) return null;
  const other = lots.find((l) => l.due !== first.due && !isExpired(l));
  return other ? { expired: first, other } : null;
}

/** Carte « À consommer » de l'accueil : DLC imprimées passées ou urgentes, la plus proche d'abord. */
export function expiringItems(entries: readonly { product: Pick<Product, 'code'> & { current: { name: string } }; lots: readonly LotView[] }[]): ExpiringItem[] {
  const items: ExpiringItem[] = [];
  for (const { product, lots } of entries) {
    const alerting = lots.filter((l) => l.dateKind === 'dlc' && !l.estimated && (l.level === 'passed' || l.level === 'urgent'));
    if (!alerting.length) continue;
    const first = alerting.reduce((a, b) => ((a.due as string) <= (b.due as string) ? a : b));
    items.push({ code: product.code, name: product.current.name, due: first.due as string, level: first.level as 'passed' | 'urgent', count: alerting.reduce((n, l) => n + l.count, 0) });
  }
  return items.sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name, 'fr'));
}

// --- Libellés ---

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const weekdayOf = (day: string) => WEEKDAYS[new Date(utc(day)).getUTCDay()];

/** « 9/11 » */
export const shortDay = (day: string) => {
  const [, m, d] = parts(day);
  return `${d}/${m}`;
};

/** « lundi 9 novembre 2026 » */
export function longDay(day: string): string {
  const [y, m, d] = parts(day);
  return `${weekdayOf(day)} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** « aujourd'hui », « demain », « hier », « dans 4 j », « il y a 3 j ». */
export function relativeDay(due: string, today: string): string {
  const left = daysBetween(today, due);
  if (left === 0) return 'aujourd’hui';
  if (left === 1) return 'demain';
  if (left === -1) return 'hier';
  return left > 0 ? `dans ${left} j` : `il y a ${-left} j`;
}

/** Jour d'une date proche (« lundi 9 », « samedi ») ; plus loin, « 30/11 ». */
export function nearDay(due: string, today: string, withNumber = true): string {
  const left = daysBetween(today, due);
  if (left >= -6 && left <= 6) return withNumber ? `${weekdayOf(due)} ${parts(due)[2]}` : weekdayOf(due);
  return shortDay(due);
}

/**
 * Pastille d'un lot : « DLC passée · hier », « DLC aujourd'hui », « DLC lundi 9 · dans 4 j », « DDM 30/11 · dans 25 j »,
 * « DDM passée · 2/11 », « ≈ mardi 10 · estimé », « DLC passée · encore bon » ; null sans date.
 */
export function lotLabel(lot: Pick<LotView, 'due' | 'estimated' | 'dateKind' | 'dismissed'>, today: string): string | null {
  if (lot.due === null) return null;
  const left = daysBetween(today, lot.due);
  if (lot.estimated) return `≈ ${nearDay(lot.due, today)} · estimé`;
  const kind = lot.dateKind === 'dlc' ? 'DLC' : 'DDM';
  if (left < 0) return lot.dismissed ? `${kind} passée · encore bon` : `${kind} passée · ${left >= -6 ? relativeDay(lot.due, today) : shortDay(lot.due)}`;
  if (left <= 1) return `${kind} ${relativeDay(lot.due, today)}`;
  return `${kind} ${nearDay(lot.due, today)} · ${relativeDay(lot.due, today)}`;
}

/** Pastille courte du scanner : « DLC 7/11 », « DDM 30/11 », « ≈ 10/11 ». */
export function shortLotLabel(lot: Pick<LotView, 'due' | 'estimated' | 'dateKind'>): string | null {
  if (lot.due === null) return null;
  if (lot.estimated) return `≈ ${shortDay(lot.due)}`;
  return `${lot.dateKind === 'dlc' ? 'DLC' : 'DDM'} ${shortDay(lot.due)}`;
}

/** Ton de la pastille : rouge (DLC passée), jaune (urgent ou bientôt), gris (DDM passée, plus tard, estimée). */
export function lotTone(lot: Pick<LotView, 'level' | 'dateKind' | 'estimated'>): 'bad' | 'warn' | 'muted' {
  if (lot.level === 'passed') return lot.dateKind === 'dlc' && !lot.estimated ? 'bad' : 'muted';
  if (lot.level === 'urgent' || lot.level === 'soon') return lot.estimated ? 'muted' : 'warn';
  return 'muted';
}

/** Carte de l'accueil : « Crème fraîche (hier) · jambon blanc (aujourd'hui) », deux noms au plus, puis « + 2 ». */
export function expiringLine(items: readonly ExpiringItem[], today: string, max = 2): { names: { name: string; when: string }[]; more: number } {
  return {
    names: items.slice(0, max).map((i) => ({ name: i.name, when: relativeDay(i.due, today) })),
    more: Math.max(0, items.length - max),
  };
}

// --- Menu ---

/** Ingrédient relié à un produit qui arrive à date : sa clé, le produit, la date et son niveau. */
export type ExpiringIngredient = { key: string; name: string; product: string; due: string; level: ExpiryLevel; estimated: boolean };

/** Recette du carnet à cuisiner d'abord : les ingrédients qui arrivent à date qu'elle utilise. */
export type CookFirst = { recipeId: string; title: string; uses: ExpiringIngredient[] };

/** Produits reliés à un ingrédient avec un lot urgent ou bientôt (pas une DLC passée : elle ne se cuisine plus). */
export function expiringIngredients(
  products: readonly { code: string; name: string; lots: readonly LotView[] }[],
  linkOf: (code: string) => { key: string; name: string } | null,
): Map<string, ExpiringIngredient> {
  const result = new Map<string, ExpiringIngredient>();
  for (const p of products) {
    const link = linkOf(p.code);
    if (!link) continue;
    for (const lot of p.lots) {
      if (lot.due === null || (lot.level !== 'urgent' && lot.level !== 'soon')) continue;
      const known = result.get(link.key);
      if (!known || lot.due < known.due) result.set(link.key, { key: link.key, name: link.name, product: p.name, due: lot.due, level: lot.level, estimated: lot.estimated });
    }
  }
  return result;
}

/**
 * Recettes du carnet qui utilisent un ingrédient arrivant à date, triées par nombre de ces ingrédients puis par la
 * date la plus proche ; celles déjà au menu de la semaine sont écartées. `max` au plus.
 */
export function cookFirst(
  recipes: readonly { id: string; title: string; keys: readonly string[] }[],
  expiring: ReadonlyMap<string, ExpiringIngredient>,
  planned: ReadonlySet<string>,
  max = 4,
): CookFirst[] {
  const found: CookFirst[] = [];
  for (const r of recipes) {
    if (planned.has(r.id)) continue;
    const uses = [...new Set(r.keys)].map((k) => expiring.get(k)).filter((e): e is ExpiringIngredient => !!e);
    if (uses.length) found.push({ recipeId: r.id, title: r.title, uses: uses.sort((a, b) => a.due.localeCompare(b.due)) });
  }
  const nearest = (c: CookFirst) => c.uses[0].due;
  return found
    .sort((a, b) => b.uses.length - a.uses.length || nearest(a).localeCompare(nearest(b)) || a.title.localeCompare(b.title, 'fr'))
    .slice(0, max);
}

/** DLC qui finit avant un repas : le produit et sa date. Seulement un avertissement : la ligne n'est pas rachetée. */
export type MealWarning = { key: string; product: string; due: string; mealDay: string; recipeId: string; entryId: string | null };

/**
 * Avertissements du menu : pour chaque ingrédient couvert par le stock, un lot en DLC imprimée (pas « Encore bon »)
 * dont la date tombe avant le premier repas daté qui l'utilise (un repas sans jour : pas d'avertissement).
 */
export function mealWarnings(
  meals: readonly { entryId: string; recipeId: string; day: string | null; keys: readonly string[] }[],
  products: readonly { code: string; name: string; lots: readonly LotView[] }[],
  linkOf: (code: string) => { key: string } | null,
  today: string,
): Map<string, MealWarning> {
  const dlc = new Map<string, { product: string; due: string }>();
  for (const p of products) {
    const link = linkOf(p.code);
    if (!link) continue;
    for (const lot of p.lots) {
      if (lot.date === null || lot.dateKind !== 'dlc' || lot.dismissed || lot.date < today) continue;
      const known = dlc.get(link.key);
      // Le lot qui dure le plus longtemps : c'est lui qui servirait au repas.
      if (!known || lot.date > known.due) dlc.set(link.key, { product: p.name, due: lot.date });
    }
  }
  const warnings = new Map<string, MealWarning>();
  const ordered = [...meals].filter((m) => m.day !== null && m.day >= today).sort((a, b) => (a.day as string).localeCompare(b.day as string));
  for (const meal of ordered) {
    for (const key of meal.keys) {
      const lot = dlc.get(key);
      if (!lot || warnings.has(key) || lot.due >= (meal.day as string)) continue;
      warnings.set(key, { key, product: lot.product, due: lot.due, mealDay: meal.day as string, recipeId: meal.recipeId, entryId: meal.entryId });
    }
  }
  return warnings;
}

/** « Le stock finit samedi (DLC) » */
export const mealWarningText = (w: Pick<MealWarning, 'due'>, today: string) => `Le stock finit ${nearDay(w.due, today, false)} (DLC)`;
