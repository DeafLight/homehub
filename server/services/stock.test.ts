// Tests des règles du stock sans HTTP : code scanné, base de produits, suite sur la liste de courses, annulation.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { containerCode } from '../../shared/barcode.ts';
import type { Author } from '../../shared/types.ts';
import { createListsStore } from '../sources/lists.ts';
import type { BaseProduct } from '../sources/open-food-facts.ts';
import { createStockStore } from '../sources/stock.ts';
import { fixedClock } from '../testing.ts';
import { createStockService } from './stock.ts';

const COMPOTE = '3560070446117';
const MYSTERE = '4006381333931';
const BY: Author = { ownerId: 'alex', via: 'tablet' };

function setup(catalog: Record<string, BaseProduct | 'error'> = {}, withBase = true) {
  const dir = mkdtempSync(join(tmpdir(), 'homehub-stock-service-'));
  const stock = createStockStore({ path: join(dir, 'stock.json'), clock: fixedClock });
  const lists = createListsStore({ path: join(dir, 'lists.json'), clock: fixedClock });
  const errors: string[] = [];
  const productBase = {
    async find(code: string) {
      const found = catalog[code];
      if (found === 'error') throw new Error('injoignable');
      return found ?? null;
    },
  };
  const service = createStockService({
    stock,
    lists,
    clock: fixedClock,
    logger: { error: (m: string) => void errors.push(m) },
    ...(withBase && { productBase }),
  });
  return { service, stock, lists, errors };
}

const compote: BaseProduct = { info: { name: 'Compote pomme', brand: 'Verger', quantity: '4 x 100 g' }, image: null, base: 'open-food-facts' };

describe('createStockService', () => {
  it('scan : produit trouvé dans la base, enregistré, puis connu', async () => {
    const { service, stock } = setup({ [COMPOTE]: compote });
    const lookup = await service.scan(COMPOTE);
    expect(lookup).toMatchObject({ kind: 'product', product: { current: { name: 'Compote pomme' } }, quantity: 0 });
    expect(await stock.product(COMPOTE)).not.toBeNull();
  });

  it('scan : inconnu, avec la suggestion de la base quand elle n’a pas de nom ; base en panne signalée', async () => {
    const { service, errors } = setup({ [MYSTERE]: { info: { name: '', brand: 'Marque' }, image: null, base: 'x' }, [COMPOTE]: 'error' });
    expect(await service.scan(MYSTERE)).toEqual({ kind: 'unknown', code: MYSTERE, suggestion: { brand: 'Marque', quantity: null }, baseError: false });
    expect(await service.scan(COMPOTE)).toEqual({ kind: 'unknown', code: COMPOTE, suggestion: null, baseError: true });
    expect(errors).toHaveLength(1);
  });

  it('scan : sans base, tout inconnu se saisit à la main ; étiquette de contenant inconnue : null', async () => {
    const { service, stock } = setup({}, false);
    expect(await service.scan(COMPOTE)).toMatchObject({ kind: 'unknown', baseError: false });
    const container = await stock.addContainer('Bocal');
    expect(await service.scan(container.code)).toMatchObject({ kind: 'container', container: { name: 'Bocal' } });
    expect(await service.scan(containerCode(99))).toBeNull();
  });

  it('sortie du dernier : proposé sur la liste, ou ajouté d’office ; annuler retire l’article ajouté', async () => {
    const { service, stock, lists } = setup({ [COMPOTE]: compote });
    await service.scan(COMPOTE);
    await service.stockIn(COMPOTE, 1, null, BY);
    const proposed = await service.stockOut(COMPOTE, { all: false, refill: null, remaining: 0 }, BY);
    expect(proposed).toMatchObject({ quantity: 0, shopping: 'propose', shoppingLabel: 'Compote pomme' });

    await stock.saveSettings({ autoShop: true });
    await service.stockIn(COMPOTE, 1, null, BY);
    const added = await service.stockOut(COMPOTE, { all: false, refill: null, remaining: 0 }, BY);
    expect(added).toMatchObject({ shopping: 'added' });
    expect((await lists.lists()).shopping.map((s) => s.label)).toEqual(['Compote pomme']);

    expect(await service.undo((added as { movementId: string }).movementId)).toEqual({ quantity: 1 });
    expect((await lists.lists()).shopping).toEqual([]);
  });

  it('refus métier : produit inconnu, contenant inconnu, mouvement plus récent', async () => {
    const { service } = setup({ [COMPOTE]: compote });
    expect(await service.stockIn(MYSTERE, 1, null, BY)).toEqual({ refused: 'unknown-product' });
    await service.scan(COMPOTE);
    expect(await service.stockOut(COMPOTE, { all: false, refill: 'absent', remaining: 0 }, BY)).toEqual({ refused: 'unknown-container' });
    const first = (await service.stockIn(COMPOTE, 1, null, BY)) as { movementId: string };
    await service.stockIn(COMPOTE, 1, null, BY);
    expect(await service.undo(first.movementId)).toEqual({ refused: 'newer-movement' });
    expect(await service.undo('inconnu')).toEqual({ refused: 'no-movement' });
    expect(await service.emptyContainer('absent', BY)).toEqual({ refused: 'unknown-container' });
  });

  it('revérifier et accepter la base', async () => {
    const { service, stock } = setup({ [COMPOTE]: { ...compote, info: { ...compote.info, quantity: '6 x 100 g' } } });
    await stock.saveManual(COMPOTE, { name: 'Compote pomme', brand: 'Verger', quantity: '4 x 100 g', category: 'Desserts' });
    expect(await service.recheck(COMPOTE)).toMatchObject({ differs: true, base: { quantity: '6 x 100 g', category: 'Desserts' } });
    expect(await service.recheck(MYSTERE)).toBeNull();
    expect(await service.acceptBase(COMPOTE)).toMatchObject({ current: { quantity: '6 x 100 g' }, conflict: null });
  });
});
