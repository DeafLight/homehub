// Tests des dates de péremption : année devinée, niveaux et seuils, estimation par rayon, ordre de sortie, libellés,
// carte de l'accueil et liens avec le menu.
import { describe, expect, it } from 'vitest';
import {
  asksDate,
  cookFirst,
  daysBetween,
  DEFAULT_EXPIRY,
  expiringIngredients,
  expiringItems,
  expiringLine,
  fefo,
  guessDay,
  isDay,
  keepDaysOf,
  levelOf,
  lotLabel,
  lotTone,
  mealWarnings,
  monthEnd,
  productDateKind,
  shiftDay,
  shortLotLabel,
  storedLots,
  toConsume,
  viewLot,
  viewLots,
  whichLot,
  worstLot,
} from './expiry.ts';
import type { LotView, StockLot } from './types.ts';

const TODAY = '2026-11-05';
const product = (category: string | null, extra: Partial<{ dateKind: 'dlc' | 'ddm' | null; askDate: boolean | null; keepDays: number | null }> = {}) => ({
  dateKind: null,
  askDate: null,
  keepDays: null,
  ...extra,
  current: { category },
});
const lot = (over: Partial<StockLot> = {}): StockLot => ({ id: 'a', count: 1, in: '2026-11-05T08:00:00', date: null, kind: null, dismissed: false, ...over });

describe('jours', () => {
  it('compte les jours et décale sans heure', () => {
    expect(daysBetween('2026-11-05', '2026-11-09')).toBe(4);
    expect(daysBetween('2026-11-05', '2026-11-04')).toBe(-1);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // passage à l'heure d'été
    expect(shiftDay('2026-12-30', 3)).toBe('2027-01-02');
    expect(isDay('2027-02-29')).toBe(false);
    expect(isDay('2028-02-29')).toBe(true);
    expect(monthEnd(3, 2027)).toBe('2027-03-31');
    expect(monthEnd(2, 2028)).toBe('2028-02-29');
  });

  it('devine l’année : prochaine occurrence, sauf à plus de 10 mois (date passée)', () => {
    expect(guessDay(9, 11, TODAY)).toBe('2026-11-09');
    expect(guessDay(5, 11, TODAY)).toBe('2026-11-05');
    expect(guessDay(15, 3, TODAY)).toBe('2027-03-15');
    expect(guessDay(3, 11, TODAY)).toBe('2026-11-03'); // avant-hier : déjà passée
    expect(guessDay(10, 8, TODAY)).toBe('2027-08-10'); // 9 mois devant
    expect(guessDay(10, 10, TODAY)).toBe('2026-10-10'); // 11 mois devant : passée
    expect(guessDay(31, 2, TODAY)).toBeNull();
    expect(guessDay(29, 2, '2027-11-05')).toBe('2028-02-29');
  });
});

describe('produit', () => {
  it('DLC pour un rayon frais, DDM sinon, ou le choix retenu', () => {
    expect(productDateKind(product('Crèmerie'))).toBe('dlc');
    expect(productDateKind(product('Épicerie'))).toBe('ddm');
    expect(productDateKind(product(null))).toBe('ddm');
    expect(productDateKind(product('Épicerie', { dateKind: 'dlc' }))).toBe('dlc');
  });

  it('« Date ? » : frais ou déjà daté, jamais après « Ne plus demander »', () => {
    expect(asksDate(product('Frais'))).toBe(true);
    expect(asksDate(product('Épicerie'))).toBe(false);
    expect(asksDate(product('Épicerie', { askDate: true }))).toBe(true);
    expect(asksDate(product('Crèmerie', { askDate: false }))).toBe(false);
  });

  it('durée : celle du produit, sinon celle du rayon', () => {
    expect(keepDaysOf(product('Boulangerie'), DEFAULT_EXPIRY)).toBe(2);
    expect(keepDaysOf(product('Fruits et légumes', { keepDays: 21 }), DEFAULT_EXPIRY)).toBe(21);
    expect(keepDaysOf(product('Épicerie'), DEFAULT_EXPIRY)).toBeNull();
  });
});

describe('lots', () => {
  it('lit un ancien fichier comme un seul lot sans date', () => {
    expect(storedLots({ quantity: 3, updatedAt: '2026-11-01T10:00:00Z' }, 'x')).toEqual([{ id: 'x', count: 3, in: '2026-11-01T10:00:00Z', date: null, kind: null, dismissed: false }]);
    expect(storedLots({ quantity: 0, updatedAt: '2026-11-01T10:00:00Z' }, 'x')).toEqual([]);
  });

  it('sort la date la plus proche d’abord, sans date en dernier, puis le plus ancien entré', () => {
    const order = fefo([
      lot({ id: 'sans', date: null, in: '2026-10-01' }),
      lot({ id: 'tard', date: '2026-11-20' }),
      lot({ id: 'tot-2', date: '2026-11-07', in: '2026-11-04' }),
      lot({ id: 'tot-1', date: '2026-11-07', in: '2026-11-02' }),
    ]).map((l) => l.id);
    expect(order).toEqual(['tot-1', 'tot-2', 'tard', 'sans']);
  });

  it('niveaux selon le type et les seuils', () => {
    const s = DEFAULT_EXPIRY;
    expect(levelOf('2026-11-04', 'dlc', false, false, TODAY, s)).toBe('passed');
    expect(levelOf('2026-11-07', 'dlc', false, false, TODAY, s)).toBe('urgent');
    expect(levelOf('2026-11-10', 'dlc', false, false, TODAY, s)).toBe('soon');
    expect(levelOf('2026-11-11', 'dlc', false, false, TODAY, s)).toBe('later');
    expect(levelOf('2026-11-07', 'ddm', false, false, TODAY, s)).toBe('soon');
    expect(levelOf('2026-12-05', 'ddm', false, false, TODAY, s)).toBe('soon');
    expect(levelOf('2026-12-06', 'ddm', false, false, TODAY, s)).toBe('later');
    expect(levelOf('2026-11-06', 'dlc', true, false, TODAY, s)).toBe('soon'); // estimée : jamais urgente
    expect(levelOf('2026-11-08', 'dlc', true, false, TODAY, s)).toBe('later');
    expect(levelOf('2026-11-01', 'dlc', false, true, TODAY, s)).toBe('later'); // « Encore bon »
    expect(levelOf(null, 'dlc', false, false, TODAY, s)).toBe('none');
  });

  it('estime la date d’un lot sans date d’après le rayon', () => {
    const view = viewLot(lot({ in: '2026-11-05T08:00:00' }), product('Fruits et légumes'), DEFAULT_EXPIRY, TODAY);
    expect(view).toMatchObject({ due: '2026-11-10', estimated: true, dateKind: 'dlc', level: 'later' });
    expect(viewLot(lot(), product('Épicerie'), DEFAULT_EXPIRY, TODAY)).toMatchObject({ due: null, level: 'none' });
    expect(viewLot(lot({ date: '2026-11-06' }), product('Fruits et légumes'), DEFAULT_EXPIRY, TODAY)).toMatchObject({ due: '2026-11-06', estimated: false, level: 'urgent' });
  });

  it('le plus urgent, et le filtre « À consommer »', () => {
    const lots = viewLots([lot({ id: '1', date: '2026-11-20' }), lot({ id: '2', date: '2026-11-04' })], product('Crèmerie'), DEFAULT_EXPIRY, TODAY);
    expect(worstLot(lots)?.id).toBe('2');
    expect(lots.filter(toConsume).map((l) => l.id)).toEqual(['2']);
    expect(worstLot(viewLots([lot()], product('Épicerie'), DEFAULT_EXPIRY, TODAY))).toBeNull();
  });

  it('« Lequel ? » seulement si le premier à sortir est passé et qu’un autre ne l’est pas', () => {
    const view = (lots: StockLot[]) => viewLots(lots, product('Crèmerie'), DEFAULT_EXPIRY, TODAY);
    expect(whichLot(view([lot({ id: 'p', date: '2026-11-03' }), lot({ id: 'b', date: '2026-11-15' })]))).toMatchObject({ expired: { id: 'p' }, other: { id: 'b' } });
    expect(whichLot(view([lot({ id: 'b', date: '2026-11-15' }), lot({ id: 'c', date: '2026-11-18' })]))).toBeNull();
    expect(whichLot(view([lot({ id: 'p', date: '2026-11-03' })]))).toBeNull();
  });
});

describe('libellés', () => {
  const view = (over: Partial<StockLot>, category = 'Crèmerie') => viewLot(lot(over), product(category), DEFAULT_EXPIRY, TODAY);

  it('pastilles de la page Stock', () => {
    expect(lotLabel(view({ date: '2026-11-04' }), TODAY)).toBe('DLC passée · hier');
    expect(lotLabel(view({ date: '2026-11-05' }), TODAY)).toBe('DLC aujourd’hui');
    expect(lotLabel(view({ date: '2026-11-09' }), TODAY)).toBe('DLC lundi 9 · dans 4 j');
    expect(lotLabel(view({ date: '2026-11-30' }, 'Épicerie'), TODAY)).toBe('DDM 30/11 · dans 25 j');
    expect(lotLabel(view({ date: '2026-10-20' }, 'Épicerie'), TODAY)).toBe('DDM passée · 20/10');
    expect(lotLabel(view({}, 'Fruits et légumes'), TODAY)).toBe('≈ mardi 10 · estimé');
    expect(lotLabel(view({ date: '2026-11-04', dismissed: true }), TODAY)).toBe('DLC passée · encore bon');
    expect(lotLabel(view({}, 'Épicerie'), TODAY)).toBeNull();
    expect(shortLotLabel(view({ date: '2026-11-07' }))).toBe('DLC 7/11');
  });

  it('tons : rouge pour la DLC passée, gris pour la DDM passée et l’estimée', () => {
    expect(lotTone(view({ date: '2026-11-04' }))).toBe('bad');
    expect(lotTone(view({ date: '2026-11-04' }, 'Épicerie'))).toBe('muted');
    expect(lotTone(view({ date: '2026-11-06' }))).toBe('warn');
    expect(lotTone(view({ in: '2026-11-04T08:00:00' }, 'Boulangerie'))).toBe('muted');
  });
});

describe('accueil', () => {
  const entry = (code: string, name: string, lots: StockLot[], category = 'Crèmerie') => ({ product: { code, current: { name } }, lots: viewLots(lots, product(category), DEFAULT_EXPIRY, TODAY) });

  it('DLC imprimées passées ou urgentes seulement, la plus proche d’abord', () => {
    const items = expiringItems([
      entry('1', 'Jambon blanc', [lot({ date: '2026-11-05' })]),
      entry('2', 'Crème fraîche', [lot({ date: '2026-11-04' }), lot({ id: 'b', date: '2026-11-20' })]),
      entry('3', 'Biscottes', [lot({ date: '2026-11-04' })], 'Épicerie'),
      entry('4', 'Pain', [lot({ in: '2026-11-02T08:00:00' })], 'Boulangerie'),
      entry('5', 'Yaourts', [lot({ date: '2026-11-09' })]),
    ]);
    expect(items).toEqual([
      { code: '2', name: 'Crème fraîche', due: '2026-11-04', level: 'passed', count: 1 },
      { code: '1', name: 'Jambon blanc', due: '2026-11-05', level: 'urgent', count: 1 },
    ]);
    expect(expiringLine(items, TODAY)).toEqual({ names: [{ name: 'Crème fraîche', when: 'hier' }, { name: 'Jambon blanc', when: 'aujourd’hui' }], more: 0 });
  });
});

describe('menu', () => {
  const lots = (date: string, kind: 'dlc' | 'ddm' = 'dlc'): LotView[] => viewLots([lot({ date, kind })], product('Crèmerie'), DEFAULT_EXPIRY, TODAY);
  const links: Record<string, { key: string; name: string }> = { c: { key: 'creme-fraiche', name: 'crème fraîche' }, j: { key: 'jambon', name: 'jambon' }, y: { key: 'yaourt', name: 'yaourt' } };

  it('recettes à cuisiner d’abord : nombre d’ingrédients, puis date', () => {
    const expiring = expiringIngredients(
      [
        { code: 'c', name: 'Crème fraîche', lots: lots('2026-11-06') },
        { code: 'j', name: 'Jambon blanc', lots: lots('2026-11-05') },
        { code: 'y', name: 'Yaourts', lots: lots('2026-11-09') },
      ],
      (code) => links[code] ?? null,
    );
    const found = cookFirst(
      [
        { id: 'g', title: 'Gâteau au yaourt', keys: ['yaourt', 'farine'] },
        { id: 'q', title: 'Quiche lorraine', keys: ['creme-fraiche', 'jambon', 'oeuf'] },
        { id: 'p', title: 'Pâtes', keys: ['pate'] },
        { id: 't', title: 'Tarte', keys: ['creme-fraiche'] },
      ],
      expiring,
      new Set(['t']),
    );
    expect(found.map((f) => f.recipeId)).toEqual(['q', 'g']);
    expect(found[0].uses.map((u) => u.product)).toEqual(['Jambon blanc', 'Crème fraîche']);
  });

  it('une DLC qui finit avant le repas donne un avertissement', () => {
    const warnings = mealWarnings(
      [
        { entryId: 'e1', recipeId: 'crepes', day: '2026-11-06', keys: ['creme-fraiche'] },
        { entryId: 'e2', recipeId: 'tarte', day: '2026-11-08', keys: ['creme-fraiche', 'yaourt'] },
        { entryId: 'e3', recipeId: 'sans-jour', day: null, keys: ['yaourt'] },
      ],
      [
        { code: 'c', name: 'Crème fraîche', lots: lots('2026-11-07') },
        { code: 'y', name: 'Yaourts', lots: lots('2026-11-07', 'ddm') },
      ],
      (code) => links[code] ?? null,
      TODAY,
    );
    expect([...warnings.values()]).toEqual([{ key: 'creme-fraiche', product: 'Crème fraîche', due: '2026-11-07', mealDay: '2026-11-08', recipeId: 'tarte', entryId: 'e2' }]);
  });
});
