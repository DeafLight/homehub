// Tests du magasin du stock : versions des fiches, entrées et sorties, transvasement, annulation et contenants.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOW, fixedClock } from '../testing.ts';
import { BASE_REREAD_DAYS, createStockStore, needsBaseRead } from './stock.ts';

const by = { ownerId: 'alex', via: 'tablet' as const };
const tempPath = () => join(mkdtempSync(join(tmpdir(), 'homehub-stock-')), 'stock.json');
const store = () => createStockStore({ path: tempPath(), clock: fixedClock });
const pasta = { name: 'Pâtes', brand: 'Marque A', quantity: '500 g', category: null };
const reading = (info = pasta) => ({ info, image: null, base: 'open-food-facts', categories: [] as string[] });

describe('fiches des produits', () => {
  it('garde une version par changement venu de la base, et le rayon choisi à la main', async () => {
    const s = store();
    await s.saveFromBase('111', reading());
    await s.saveManual('111', { ...pasta, category: 'Épicerie' });
    expect((await s.product('111'))?.versionCount).toBe(1); // seul le rayon change
    const next = await s.saveFromBase('111', reading({ ...pasta, quantity: '1 kg' }));
    expect(next.versionCount).toBe(2);
    expect(next.current).toMatchObject({ quantity: '1 kg', category: 'Épicerie', source: 'base' });
  });

  it('notre correction l’emporte : la base en désaccord devient un conflit, à trancher', async () => {
    const s = store();
    await s.saveFromBase('111', reading());
    await s.saveManual('111', { ...pasta, name: 'Coquillettes' });
    const product = await s.saveFromBase('111', reading());
    expect(product.current.name).toBe('Coquillettes');
    expect(product.conflict?.name).toBe('Pâtes');
    const taken = await s.resolveConflict('111', 'base');
    expect(taken?.current.name).toBe('Pâtes');
    expect(taken?.conflict).toBeNull();
  });

  it('relit la base après BASE_REREAD_DAYS jours, jamais pour une fiche saisie à la main', async () => {
    const s = store();
    const read = await s.saveFromBase('111', reading());
    const manual = await s.saveManual('222', pasta);
    const later = new Date(NOW.getTime() + (BASE_REREAD_DAYS + 1) * 86_400_000);
    expect(needsBaseRead(null, NOW)).toBe(true);
    expect(needsBaseRead(read, NOW)).toBe(false);
    expect(needsBaseRead(read, later)).toBe(true);
    expect(needsBaseRead(manual, later)).toBe(false);
  });

  it('copie les catégories de la base ; une fiche lue avant qu’on les copie est relue une fois', async () => {
    const s = store();
    const read = await s.saveFromBase('111', { ...reading(), categories: ['en:cereals-and-potatoes', 'en:pastas'] });
    expect(read.categories).toEqual(['en:cereals-and-potatoes', 'en:pastas']);
    expect(needsBaseRead(read, NOW)).toBe(false);
    // Fiche d'avant 0.62 : lue, sans catégories copiées.
    expect(needsBaseRead({ ...read, categories: null }, NOW)).toBe(true);
    // Relue sans catégories (hygiène, lessive…) : liste vide, plus de relecture.
    const empty = await s.saveFromBase('111', reading());
    expect(empty.categories).toEqual([]);
    expect(needsBaseRead(empty, NOW)).toBe(false);
    expect((await s.saveManual('222', pasta)).categories).toBeNull();
  });
});

describe('entrées et sorties', () => {
  it('compte les entrées et les sorties, et signale le produit épuisé', async () => {
    const s = store();
    await s.saveFromBase('111', reading());
    expect((await s.add('111', 2, 1.5, by)).quantity).toBe(2);
    expect(await s.remove('111', {}, by)).toMatchObject({ quantity: 1, exhausted: false, forgotten: false, autoShop: false });
    expect(await s.remove('111', {}, by)).toMatchObject({ quantity: 0, exhausted: true });
    const data = await s.data();
    expect(data.items[0]).toMatchObject({ quantity: 0, lastIn: { by }, lastOut: { by } });
  });

  it('sortie d’un produit absent : entrée oubliée, ce qui reste entre au stock', async () => {
    const s = store();
    expect(await s.remove('111', { remaining: 3 }, by)).toMatchObject({ forgotten: true, quantity: 3, exhausted: false });
  });

  it('« tout » vide le stock du produit ; le réglage du produit prime sur celui du stock', async () => {
    const s = store();
    await s.saveFromBase('111', reading());
    await s.add('111', 4, null, by);
    await s.saveSettings({ autoShop: true });
    await s.setPreferences('111', { autoShop: false });
    expect(await s.remove('111', { all: true }, by)).toMatchObject({ quantity: 0, exhausted: true, autoShop: false });
  });

  it('transvasé : le contenant se remplit, est retenu pour ce produit, et rien n’est épuisé', async () => {
    const s = store();
    await s.saveFromBase('111', reading());
    await s.add('111', 1, null, by);
    const jar = await s.addContainer('Bocal');
    const out = await s.remove('111', { refill: jar.id }, by);
    expect(out).toMatchObject({ quantity: 0, exhausted: false, container: { full: true, productName: 'Pâtes' } });
    expect((await s.product('111'))?.refill).toBe(jar.id);
    const emptied = await s.emptyContainer(jar.id, by);
    expect(emptied).toMatchObject({ productCode: '111', exhausted: true, container: { full: false } });
  });

  it('n’annule que le dernier mouvement d’un produit, et rend la quantité d’avant', async () => {
    const s = store();
    const first = await s.add('111', 1, null, by);
    const second = await s.add('111', 2, null, by);
    expect(await s.undo(first.movementId)).toEqual({ ok: false, shoppingId: null, code: '111' });
    await s.attachShopping(second.movementId, 'courses-1');
    expect(await s.undo(second.movementId)).toEqual({ ok: true, shoppingId: 'courses-1', code: '111' });
    expect(await s.quantity('111')).toBe(1);
    expect(await s.undo(second.movementId)).toMatchObject({ ok: false });
    expect((await s.movements('111')).map((m) => m.undone)).toEqual([true, false]);
  });

  it('annuler un transvasement vide le contenant et oublie le contenant retenu', async () => {
    const s = store();
    await s.saveFromBase('111', reading());
    await s.add('111', 1, null, by);
    const jar = await s.addContainer('Bocal');
    const out = await s.remove('111', { refill: jar.id }, by);
    expect((await s.undo(out.movementId)).ok).toBe(true);
    expect(await s.container(jar.code)).toMatchObject({ full: false, productCode: null });
    expect((await s.product('111'))?.refill).toBeNull();
    expect(await s.quantity('111')).toBe(1);
  });
});

describe('contenants', () => {
  it('numérote les étiquettes, renomme, et retire le contenant retenu par les produits', async () => {
    const s = store();
    await s.saveFromBase('111', reading());
    const a = await s.addContainer('Bidon');
    const b = await s.addContainer('Bocal');
    expect(a.code).not.toBe(b.code);
    expect((await s.renameContainer(a.id, 'Bidon de lessive'))?.name).toBe('Bidon de lessive');
    await s.setPreferences('111', { refill: a.id });
    expect(await s.removeContainer(a.id)).toBe(true);
    expect(await s.removeContainer(a.id)).toBe(false);
    expect((await s.product('111'))?.refill).toBeNull();
    expect((await s.data()).containers.map((c) => c.name)).toEqual(['Bocal']);
  });
});

describe('décompte « J’ai cuisiné »', () => {
  it('sort N paquets d’un coup, retient la part restante, groupe les mouvements et les annule ensemble', async () => {
    const s = store();
    await s.saveManual('111', pasta);
    await s.add('111', 3, null, by);
    const outs = await s.cook('c1', 'Cuisiné : Pâtes au thon', [{ code: '111', remove: 2, opened: 0.5, container: null }], by);
    expect(outs).toEqual([expect.objectContaining({ code: '111', quantity: 1, exhausted: false })]);
    expect((await s.data()).items[0]).toMatchObject({ quantity: 1, opened: 0.5 });
    expect((await s.movements('111'))[0]).toMatchObject({ kind: 'out', count: 2, reason: 'Cuisiné : Pâtes au thon', opened: 0.5 });
    expect(await s.undoCook('c1')).toEqual({ undone: ['111'], kept: [], shoppingIds: [] });
    expect((await s.data()).items[0]).toMatchObject({ quantity: 3, opened: null });
  });

  it('jamais plus que le stock ; paquet entamé seul : un mouvement « opened »', async () => {
    const s = store();
    await s.saveManual('111', pasta);
    await s.add('111', 1, null, by);
    await s.cook('c1', 'Cuisiné : x', [{ code: '111', remove: 0, opened: 0.25, container: null }], by);
    expect((await s.movements('111'))[0]).toMatchObject({ kind: 'opened', count: 0 });
    const [out] = await s.cook('c2', 'Cuisiné : x', [{ code: '111', remove: 5, opened: null, container: null }], by);
    expect(out).toMatchObject({ quantity: 0, exhausted: true });
  });

  it('le scan du paquet vide efface la part restante ; annuler la rend', async () => {
    const s = store();
    await s.saveManual('111', pasta);
    await s.add('111', 2, null, by);
    await s.cook('c1', 'Cuisiné : x', [{ code: '111', remove: 0, opened: 0.75, container: null }], by);
    const out = await s.remove('111', {}, by);
    expect((await s.data()).items[0]).toMatchObject({ quantity: 1, opened: null });
    await s.undo(out.movementId);
    expect((await s.data()).items[0]).toMatchObject({ quantity: 2, opened: 0.75 });
  });

  it('un mouvement plus récent garde sa ligne : signalé, pas annulé', async () => {
    const s = store();
    await s.saveManual('111', pasta);
    await s.add('111', 2, null, by);
    await s.cook('c1', 'Cuisiné : x', [{ code: '111', remove: 1, container: null }], by);
    await s.add('111', 1, null, by);
    expect(await s.undoCook('c1')).toEqual({ undone: [], kept: ['111'], shoppingIds: [] });
  });
});
