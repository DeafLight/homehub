import { describe, expect, it } from 'vitest';
import { looseCode } from '../../../shared/barcode.ts';
import type { Product, LotView } from '../../../shared/types.ts';
import {
  canExhaust,
  containerState,
  filterStock,
  infoDiff,
  lastMarksLine,
  looseText,
  markLine,
  movementLabel,
  parseAmount,
  productDetail,
  productSubtitle,
  provenance,
  scanMoment,
  scannerLabel,
  stockCounts,
  stockRows,
  thrownText,
  undatedLot,
  stockText,
} from './stock.ts';

const product = (over: Partial<Product['current']> = {}, versionCount = 1): Product => ({
  code: '3560070446117',
  current: { name: 'Purée de pomme', brand: 'Carrefour Kids', quantity: '4 x 90 g', category: null, from: '2026-11-05T10:00:00Z', source: 'base', base: 'open-food-facts', ...over },
  versionCount,
  image: null,
  autoShop: null,
  refill: null,
  conflict: null,
  baseReadAt: null,
  categories: null,
  dateKind: null,
  askDate: null,
  keepDays: null,
});

describe('libellés du stock', () => {
  it('dit d’où vient la fiche', () => {
    expect(provenance(product())).toBe('Lu dans Open Food Facts le 5 novembre 2026');
    expect(provenance(product({ source: 'manual', base: null }))).toBe('Saisi à la main le 5 novembre 2026');
    expect(provenance(product({ source: 'manual', base: null }, 2))).toBe('Corrigé à la main le 5 novembre 2026 · 2 versions');
  });

  it('montre les champs qui diffèrent de la base', () => {
    const mine = product().current;
    expect(infoDiff(mine, { ...mine, quantity: '4 x 85 g', brand: null })).toEqual([
      { label: 'Marque', mine: 'Carrefour Kids', theirs: '—' },
      { label: 'Contenance', mine: '4 x 90 g', theirs: '4 x 85 g' },
    ]);
    expect(infoDiff(mine, mine)).toEqual([]);
  });

  it('résume marque, contenance et quantité', () => {
    expect(productDetail({ brand: 'X', quantity: null })).toBe('X');
    expect(stockText(0)).toBe('Épuisé');
    expect(stockText(2)).toBe('2 en stock');
  });
});

describe('quand et qui a scanné', () => {
  const now = new Date(2026, 10, 5, 7, 35);
  const names: Record<string, string> = { lea: 'Léa' };
  const nameOf = (id: string | null) => (id ? (names[id] ?? null) : null);
  const at = (d: Date) => d.toISOString();

  it('date le scan par rapport à aujourd’hui', () => {
    expect(scanMoment(at(new Date(2026, 10, 5, 7, 2)), now)).toBe('aujourd’hui à 07:02');
    expect(scanMoment(at(new Date(2026, 10, 4, 18, 20)), now)).toBe('hier à 18:20');
    expect(scanMoment(at(new Date(2026, 10, 2, 9, 5)), now)).toBe('lun. 2 nov. à 09:05');
    expect(scanMoment(at(new Date(2025, 2, 3, 18, 10)), now)).toBe('3 mars 2025 à 18:10');
  });

  it('nomme le profil, ou « anonyme » si personne n’était reconnu', () => {
    expect(scannerLabel({ ownerId: 'lea', via: 'phone' }, nameOf)).toBe('Léa · téléphone');
    expect(scannerLabel({ ownerId: null, via: 'tablet' }, nameOf)).toBe('anonyme · tablette');
    expect(markLine({ at: at(new Date(2026, 10, 5, 7, 2)), by: { ownerId: 'lea', via: 'tablet' } }, now, nameOf)).toBe('aujourd’hui à 07:02 · Léa · tablette');
  });

  it('résume la dernière entrée et la dernière sortie', () => {
    const lastIn = { at: at(new Date(2026, 10, 4, 18, 20)), by: { ownerId: 'lea', via: 'phone' as const } };
    const lastOut = { at: at(new Date(2026, 10, 5, 7, 30)), by: { ownerId: null, via: 'tablet' as const } };
    expect(lastMarksLine({ quantity: 1, lastIn, lastOut }, now, nameOf)).toBe('Rangé hier à 18:20 (Léa) · sorti aujourd’hui à 07:30 (anonyme)');
    expect(lastMarksLine({ quantity: 1, lastIn: null, lastOut }, now, nameOf)).toBe('Sorti aujourd’hui à 07:30 (anonyme)');
    expect(lastMarksLine({ quantity: 1, lastIn: null, lastOut: null }, now, nameOf)).toBe('');
  });

  it('ne dit d’un produit épuisé que quand et par qui', () => {
    const lastIn = { at: at(new Date(2026, 10, 4, 18, 20)), by: { ownerId: 'lea', via: 'phone' as const } };
    const lastOut = { at: at(new Date(2026, 10, 5, 7, 30)), by: { ownerId: 'lea', via: 'tablet' as const } };
    expect(lastMarksLine({ quantity: 0, lastIn, lastOut }, now, nameOf)).toBe('Épuisé aujourd’hui à 07:30 (Léa)');
    expect(lastMarksLine({ quantity: 0, lastIn: null, lastOut }, now, nameOf)).toBe('Épuisé aujourd’hui à 07:30 (Léa)');
    // Mis à zéro à la main après la dernière entrée : la sortie d'avant n'est pas ce qui l'a épuisé.
    expect(lastMarksLine({ quantity: 0, lastIn: lastOut, lastOut: lastIn }, now, nameOf)).toBe('');
    expect(lastMarksLine({ quantity: 0, lastIn, lastOut: null }, now, nameOf)).toBe('');
  });

  it('décrit chaque mouvement', () => {
    expect(movementLabel({ kind: 'in', count: 2, forgotten: false })).toBe('Rangé (+ 2)');
    expect(movementLabel({ kind: 'out', count: 1, forgotten: true })).toBe('Jeté · entrée oubliée');
    expect(movementLabel({ kind: 'adjust', count: 3, forgotten: false })).toBe('Inventaire : 3');
  });
});

describe('inventaire du stock', () => {
  const items = [
    { product: product({ name: 'Purée de pomme', brand: 'Marque' }), quantity: 2, lots: [], expiry: null },
    { product: product({ name: 'Lessive', brand: null }), quantity: 0, lots: [], expiry: null },
    { product: product({ name: 'Pâtes', brand: 'Épi' }), quantity: 1, lots: [], expiry: null },
  ];

  it('filtre en stock, épuisés ou tout, puis par nom ou marque', () => {
    expect(filterStock(items, 'in', '').map((i) => i.product.current.name)).toEqual(['Purée de pomme', 'Pâtes']);
    expect(filterStock(items, 'out', '').map((i) => i.product.current.name)).toEqual(['Lessive']);
    expect(filterStock(items, 'all', '  ÉPI ').map((i) => i.product.current.name)).toEqual(['Pâtes']);
    expect(filterStock(items, 'out', 'pâtes')).toEqual([]);
    expect(stockCounts(items)).toEqual({ in: 2, expiring: 0, out: 1, all: 3 });
  });

  it('« À consommer » : une ligne par lot qui arrive à date, la plus proche d’abord, « 1 sur 2 »', () => {
    const lot = (id: string, due: string | null, count: number, level: LotView['level']): LotView => ({
      id,
      count,
      in: '2026-11-01T08:00:00Z',
      date: due,
      kind: 'dlc',
      dismissed: false,
      due,
      estimated: false,
      dateKind: 'dlc',
      level,
    });
    const creme = { product: product({ name: 'Crème fraîche' }), quantity: 2, lots: [lot('c1', '2026-11-04', 1, 'passed'), lot('c2', '2026-11-20', 1, 'later')], expiry: null };
    const jambon = { product: product({ name: 'Jambon' }), quantity: 1, lots: [lot('j1', '2026-11-05', 1, 'urgent')], expiry: null };
    const pates = { product: product({ name: 'Pâtes' }), quantity: 1, lots: [lot('p1', null, 1, 'none')], expiry: null };
    const rows = stockRows([jambon, pates, creme], 'expiring', '');
    expect(rows.map((r) => [r.entry.product.current.name, r.lot?.id, r.part])).toEqual([
      ['Crème fraîche', 'c1', '1 sur 2'],
      ['Jambon', 'j1', null],
    ]);
    expect(stockCounts([jambon, pates, creme]).expiring).toBe(2);
    expect(undatedLot(pates)?.id).toBe('p1');
    expect(undatedLot(jambon)).toBeNull();
    expect(thrownText(0)).toBe('Rien de jeté périmé ce mois-ci');
    expect(thrownText(3)).toBe('3 produits jetés (périmés) ce mois-ci');
    expect(movementLabel({ kind: 'out', count: 1, forgotten: false, expired: 1 })).toBe('Jeté · périmé');
  });

  it('« Épuisé » actif sur un produit seul comme sur plusieurs, grisé à 0', () => {
    expect(canExhaust({ quantity: 1 })).toBe(true);
    expect(canExhaust({ quantity: 3 })).toBe(true);
    expect(canExhaust({ quantity: 0 })).toBe(false);
  });

  it('sous-titre d’un produit et état d’un contenant', () => {
    expect(productSubtitle(product({ category: 'Frais' }))).toBe('Carrefour Kids · 4 x 90 g · Frais');
    expect(productSubtitle(product({ brand: null, quantity: null }))).toBe('Toucher pour compléter la fiche');
    expect(containerState({ full: true, productName: 'Lessive' })).toBe('Lessive');
    expect(containerState({ full: true, productName: null })).toBe('Plein');
    expect(containerState({ full: false, productName: 'Lessive' })).toBe('Vide (Lessive)');
    expect(containerState({ full: false, productName: null })).toBe('Vide');
  });

  it('produit sans code-barres : provenance, sous-titre, quantité en tout', () => {
    const loose = (quantity: string, category: string | null = 'Fruits et légumes'): Product => ({
      ...product({ name: 'Pommes', brand: null, quantity, category, source: 'manual', base: null }),
      code: looseCode(1),
    });
    expect(provenance(loose('1,2 kg'))).toBe('Ajouté sans code-barres le 5 novembre 2026');
    expect(productSubtitle(loose('1,2 kg'))).toBe('Sans code-barres · 1,2 kg · Fruits et légumes');
    expect(productSubtitle(loose('1 pièce', null))).toBe('Sans code-barres');
    expect(looseText(loose('1,2 kg'), 1)).toBe('1,2 kg');
    expect(looseText(loose('1 pièce'), 6)).toBe('6 pièces');
    expect(looseText(loose('1 botte'), 0)).toBe('Épuisé');
    expect(looseText(product(), 2)).toBeNull();
  });

  it('historique : quantité changée sans unité de plus', () => {
    expect(movementLabel({ kind: 'in', count: 0, forgotten: false })).toBe('Quantité changée');
  });

  it('quantité tapée', () => {
    expect(parseAmount('1,2')).toBe(1.2);
    expect(parseAmount(' 6 ')).toBe(6);
    expect(parseAmount('0.5')).toBe(0.5);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('beaucoup')).toBeNull();
    expect(parseAmount('1,2,3')).toBeNull();
  });
});

describe('décompte « J’ai cuisiné » dans le stock', () => {
  it('historique : la recette, les paquets, ce qui reste', () => {
    expect(movementLabel({ kind: 'out', count: 2, forgotten: false, reason: 'Cuisiné : Pâtes au thon', opened: null })).toBe('Cuisiné : Pâtes au thon (− 2)');
    expect(movementLabel({ kind: 'out', count: 1, forgotten: false, reason: 'Cuisiné : Gratin', opened: 0.5 })).toBe('Cuisiné : Gratin · il en reste ½');
    expect(movementLabel({ kind: 'opened', count: 0, forgotten: false, reason: 'Cuisiné : Gratin', opened: 0.75 })).toBe('Cuisiné : Gratin · il en reste ¾');
    expect(movementLabel({ kind: 'container-empty', count: 0, forgotten: false, reason: 'Cuisiné : Crêpes', opened: null })).toBe('Cuisiné : Crêpes · contenant vidé');
  });

  it('quantité : la part restante du paquet entamé', () => {
    expect(stockText(2, 0.25)).toBe('2 en stock · entamé, il en reste ¼');
    expect(stockText(0, 0.25)).toBe('Épuisé');
  });
});
