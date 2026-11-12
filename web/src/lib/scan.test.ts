// Tests des règles du scanner : journal du passage, bandeau après une sortie, saisie à la main, caméra en panne.
import { describe, expect, it } from 'vitest';
import type { Container, Product, StockMovementResult } from '../../../shared/types.ts';
import { addEntry, afterOut, cameraProblem, entryOf, entrySubtitle, MAX_ENTRIES, markUndone, noteShoppingAdded, pendingEntry, readManualCode, refillContainer, renameProduct } from './scan.ts';

const product = (over: Partial<Product> = {}): Product => ({
  code: '3560070446117',
  current: { name: 'Purée de pomme', brand: 'Marque', quantity: '4 x 90 g', category: null, from: '2026-11-05T10:00:00Z', source: 'base', base: 'open-food-facts' },
  versionCount: 1,
  image: null,
  autoShop: null,
  refill: null,
  conflict: null,
  baseReadAt: null,
  categories: null,
  ...over,
});

const jar: Container = { id: 'c1', code: '2000000000015', name: 'Bocal à compote', productCode: null, productName: null, full: true };

const result = (over: Partial<StockMovementResult> = {}): StockMovementResult => ({
  movementId: 'm1',
  at: '2026-11-10T08:00:00Z',
  by: { ownerId: 'alex', via: 'tablet' },
  product: product(),
  quantity: 2,
  container: null,
  forgotten: false,
  shopping: 'none',
  shoppingLabel: null,
  ...over,
});

describe('journal du scanner', () => {
  it('une ligne par mouvement, avec quand et par qui', () => {
    expect(entryOf(result(), 'in', '3560070446117')).toEqual({
      id: 'm1',
      kind: 'in',
      code: '3560070446117',
      product: product(),
      title: 'Purée de pomme',
      line: 'Rangé · 2 en stock',
      mark: { at: '2026-11-10T08:00:00Z', by: { ownerId: 'alex', via: 'tablet' } },
      undone: false,
    });
  });

  it('libellés : jeté, entrée oubliée, transvasé, contenant vidé, ajouté aux courses', () => {
    expect(entryOf(result({ quantity: 0 }), 'out', 'x').line).toBe('Jeté · Épuisé');
    expect(entryOf(result({ quantity: 0, forgotten: true }), 'out', 'x').line).toBe('Jeté · entrée oubliée, épuisé');
    expect(entryOf(result({ container: jar }), 'refill', 'x').line).toBe('Transvasé dans Bocal à compote · emballage jeté');
    const emptied = entryOf(result({ container: jar, quantity: 0 }), 'empty', jar.code);
    expect(emptied.title).toBe('Bocal à compote');
    expect(emptied.line).toBe('Contenant vidé · c’était Purée de pomme, épuisé');
    expect(entryOf(result({ container: jar, product: null }), 'empty', jar.code).line).toBe('Contenant vidé');
    expect(entryOf(result({ quantity: 0, shopping: 'added' }), 'out', 'x').line).toBe('Jeté · Épuisé · ajouté à la liste de courses');
  });

  it('sous-titre : marque et contenance, sauf pour un contenant vidé', () => {
    expect(entrySubtitle(entryOf(result(), 'in', 'x'))).toBe('Marque · 4 x 90 g · Rangé · 2 en stock');
    expect(entrySubtitle(entryOf(result({ container: jar }), 'empty', 'x'))).toBe('Contenant vidé · c’était Purée de pomme, 2 en stock');
    expect(entrySubtitle(entryOf(result({ product: null }), 'in', 'x'))).toBe('Rangé · 2 en stock');
  });

  it('le plus récent en tête, 40 lignes au plus', () => {
    let entries = [entryOf(result({ movementId: 'a' }), 'in', 'x')];
    entries = addEntry(entries, entryOf(result({ movementId: 'b' }), 'in', 'x'));
    expect(entries.map((e) => e.id)).toEqual(['b', 'a']);
    for (let i = 0; i < 50; i++) entries = addEntry(entries, entryOf(result({ movementId: `n${i}` }), 'in', 'x'));
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[0].id).toBe('n49');
  });

  it('annuler, corriger la fiche, ajouter aux courses après coup', () => {
    const entries = [entryOf(result({ movementId: 'b' }), 'out', '3560070446117'), entryOf(result({ movementId: 'a' }), 'in', '3560070446117')];
    expect(markUndone(entries, 'a', 'Annulé · 1 en stock')[1]).toMatchObject({ undone: true, line: 'Annulé · 1 en stock' });
    expect(markUndone(entries, 'a', '')[0].undone).toBe(false);
    const renamed = renameProduct(entries, product({ current: { ...product().current, name: 'Compote' } }));
    expect(renamed.map((e) => e.title)).toEqual(['Compote', 'Compote']);
    expect(noteShoppingAdded(entries).map((e) => e.line)).toEqual(['Jeté · 2 en stock · ajouté à la liste de courses', 'Rangé · 2 en stock']);
  });

  it('ligne en attente pour « C’était une recharge » avant toute sortie', () => {
    expect(pendingEntry(product())).toMatchObject({ id: '', kind: 'out', title: 'Purée de pomme', mark: null });
  });

  it('contenant habituel du produit, s’il existe encore', () => {
    expect(refillContainer(product({ refill: 'c1' }), [jar])).toBe(jar);
    expect(refillContainer(product({ refill: 'gone' }), [jar])).toBeUndefined();
    expect(refillContainer(product(), [jar])).toBeUndefined();
  });
});

describe('après une sortie', () => {
  it('produit épuisé à proposer : question de la liste de courses', () => {
    const next = afterOut(result({ quantity: 0, shopping: 'propose', shoppingLabel: 'Compote' }), 'Purée de pomme', 'Marque');
    expect(next).toEqual({ flash: { tone: 'ask', title: 'Purée de pomme', detail: 'Épuisé', info: 'Marque' }, dialog: { kind: 'shop', code: '3560070446117', label: 'Compote' } });
  });

  it('sinon, où en est le stock (ou le contenant)', () => {
    expect(afterOut(result(), 'P').flash).toEqual({ tone: 'ok', title: 'P', detail: '2 en stock', info: '' });
    expect(afterOut(result({ container: jar }), 'P').flash.detail).toBe('Dans Bocal à compote');
    expect(afterOut(result({ container: jar, product: null }), 'P').flash.detail).toBe('Contenant vide');
    expect(afterOut(result({ quantity: 0, shopping: 'added' }), 'P')).toMatchObject({ flash: { detail: 'Épuisé · ajouté à la liste de courses' }, dialog: null });
  });
});

describe('saisie et caméra', () => {
  it('code tapé à la main : chiffres seuls, clé vérifiée', () => {
    expect(readManualCode(' 3560 0704 46117 ')).toEqual({ code: '3560070446117' });
    expect(readManualCode('96385074')).toEqual({ code: '0000096385074' });
    expect(readManualCode('3560070446118')).toEqual({ error: 'Code invalide : 8, 12 ou 13 chiffres, avec la clé' });
    expect(readManualCode('')).toHaveProperty('error');
  });

  it('caméra occupée, refusée sur le téléphone, ou message général', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name });
    expect(cameraProblem(named('NotReadableError'), false)).toBe('Caméra occupée : réessaie dans un instant');
    expect(cameraProblem(named('NotAllowedError'), true)).toMatch(/saisis le code à la main/u);
    expect(cameraProblem(named('NotAllowedError'), false)).toMatch(/Fully Kiosk/u);
    expect(cameraProblem(named('NotFoundError'), true)).toBe('Pas de caméra sur cet appareil');
  });
});
