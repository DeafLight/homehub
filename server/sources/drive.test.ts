// Tests du magasin du drive : réglages, produit retenu et produits de secours (jamais pris d'office), retrait,
// relecture du fichier ; pièces par paquet, panier en cours (lignes par article, nettoyées, nouveau panier), fichier
// de l'étape 1 relu tel quel ; prix et EAN lus sur la fiche par l'extension (étape 3).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DriveProduct } from '../../shared/drive.ts';
import { fixedClock } from '../testing.ts';
import { createDriveStore } from './drive.ts';

const by = { ownerId: 'alex', via: 'phone' } as const;
const product = (id: string, name = `Produit ${id}`): DriveProduct => ({
  enseigne: 'coursesu',
  id,
  url: `https://www.coursesu.com/p/x/${id}.html`,
  name,
  brand: null,
  packText: '200 g',
  pack: { quantity: 200, unit: 'g' },
  ean: null,
  source: 'manual',
  seenAt: fixedClock().toISOString(),
  pieces: null,
  price: null,
  missingAt: null,
});

function setup() {
  const path = join(mkdtempSync(join(tmpdir(), 'homehub-drive-')), 'drive.json');
  return { path, store: createDriveStore({ path, clock: fixedClock }) };
}

describe('magasin du drive', () => {
  it('réglages : aucune enseigne au départ, puis gardés', async () => {
    const { path, store } = setup();
    expect(await store.settings()).toEqual({ enseigne: null, store: null });
    await store.setSettings({ enseigne: 'coursesu', store: { name: 'Super U Exemple', url: null } });
    expect(await createDriveStore({ path, clock: fixedClock }).settings()).toEqual({ enseigne: 'coursesu', store: { name: 'Super U Exemple', url: null } });
  });

  it('un nouveau produit retenu fait de l’ancien un secours ; un secours peut redevenir le retenu', async () => {
    const { store } = setup();
    await store.choose({ key: 'lardon', label: 'Lardons', product: product('1'), role: 'preferred' }, by);
    let choice = await store.choose({ key: 'lardon', label: 'Lardons', product: product('2'), role: 'preferred' }, by);
    expect(choice?.preferred?.id).toBe('2');
    expect(choice?.fallback.map((p) => p.id)).toEqual(['1']);
    choice = await store.choose({ key: 'lardon', label: 'Lardons', product: product('1'), role: 'preferred' }, by);
    expect(choice?.preferred?.id).toBe('1');
    expect(choice?.fallback.map((p) => p.id)).toEqual(['2']);
  });

  it('secours : ajouté sans toucher au retenu, au plus 3, le retenu peut y passer', async () => {
    const { store } = setup();
    await store.choose({ key: 'lardon', label: 'Lardons', product: product('1'), role: 'preferred' }, by);
    for (const id of ['2', '3', '4', '5']) await store.choose({ key: 'lardon', label: 'Lardons', product: product(id), role: 'fallback' }, by);
    let [choice] = await store.choices();
    expect(choice.preferred?.id).toBe('1');
    expect(choice.fallback.map((p) => p.id)).toEqual(['3', '4', '5']);
    choice = (await store.choose({ key: 'lardon', label: 'Lardons', product: product('1'), role: 'fallback' }, by))!;
    expect(choice.preferred).toBeNull();
  });

  it('retirer le produit retenu ne prend aucun secours d’office ; un choix vidé disparaît', async () => {
    const { store } = setup();
    await store.choose({ key: 'lardon', label: 'Lardons', product: product('1'), role: 'preferred' }, by);
    await store.choose({ key: 'lardon', label: 'Lardons', product: product('2'), role: 'fallback' }, by);
    expect(await store.forget('lardon', 'coursesu', '1', by)).toBe(true);
    const [choice] = await store.choices();
    expect(choice.preferred).toBeNull();
    expect(choice.fallback.map((p) => p.id)).toEqual(['2']);
    expect(await store.forget('lardon', 'coursesu', '9', by)).toBe(false);
    expect(await store.forget('lardon', 'coursesu', '2', by)).toBe(true);
    expect(await store.choices()).toEqual([]);
    expect(await store.forget('lardon', 'coursesu', null, by)).toBe(false);
  });

  it('un choix par article : retirer tout le choix', async () => {
    const { store } = setup();
    await store.choose({ key: 'lardon', label: 'Lardons', product: product('1'), role: 'preferred' }, by);
    await store.choose({ key: 'lessive', label: 'Lessive', product: product('7'), role: 'preferred' }, by);
    expect(await store.forget('lardon', 'coursesu', null, by)).toBe(true);
    expect((await store.choices()).map((c) => c.key)).toEqual(['lessive']);
  });

  it('pièces par paquet : retenues sur le produit, gardées quand il change de rôle, oubliées sur demande', async () => {
    const { store } = setup();
    await store.choose({ key: 'oignon', label: 'Oignons', product: product('1'), role: 'preferred' }, by);
    expect((await store.setPieces('oignon', 'coursesu', '1', 6, by))?.preferred?.pieces).toBe(6);
    expect(await store.setPieces('oignon', 'coursesu', '9', 6, by)).toBeNull();
    let choice = await store.choose({ key: 'oignon', label: 'Oignons', product: product('2'), role: 'preferred' }, by);
    expect(choice?.fallback[0]).toMatchObject({ id: '1', pieces: 6 });
    choice = await store.choose({ key: 'oignon', label: 'Oignons', product: product('1'), role: 'preferred' }, by);
    expect(choice?.preferred?.pieces).toBe(6);
    expect((await store.setPieces('oignon', 'coursesu', '1', null, by))?.preferred?.pieces).toBeNull();
  });

  it('panier : une ligne par article, remplacée, retirée ; les articles partis de la liste s’en vont', async () => {
    const { path, store } = setup();
    expect(await store.basket()).toBeNull();
    const line = (itemId: string, count = 1) => ({ itemId, key: itemId, label: itemId, product: null, count, per: null });
    await store.putInBasket('coursesu', line('a'), new Set(['a', 'b']), by);
    await store.putInBasket('coursesu', line('b'), new Set(['a', 'b']), by);
    let basket = await store.putInBasket('coursesu', line('a', 3), new Set(['a', 'b']), by);
    expect(basket?.lines.map((l) => [l.itemId, l.count])).toEqual([['b', 1], ['a', 3]]);
    expect(basket).toMatchObject({ enseigne: 'coursesu', startedBy: by, startedAt: fixedClock().toISOString() });
    basket = await store.takeOutOfBasket('a', new Set(['a']));
    expect(basket?.lines).toEqual([]);
    await store.putInBasket('coursesu', line('c'), new Set(['c']), by);
    expect((await createDriveStore({ path, clock: fixedClock }).basket())?.lines.map((l) => l.itemId)).toEqual(['c']);
    await store.clearBasket();
    expect(await store.basket()).toBeNull();
  });

  it('relit un fichier de l’étape 1 (sans pièces ni panier)', async () => {
    const { path } = setup();
    const { pieces: _pieces, price: _price, missingAt: _missingAt, ...old } = product('1');
    writeFileSync(path, JSON.stringify({ version: 1, settings: { enseigne: 'coursesu', store: null }, choices: [{ key: 'lardon', enseigne: 'coursesu', label: 'Lardons', preferred: old, fallback: [], updatedAt: '', updatedBy: by }] }));
    const store = createDriveStore({ path, clock: fixedClock });
    expect((await store.choices())[0].preferred?.pieces).toBeNull();
    expect((await store.choices())[0].preferred?.price).toBeNull();
    expect(await store.basket()).toBeNull();
  });

  it('introuvable ou en rupture : signalé pour le panier, remplacement, trace sur le produit effacée quand il repart au panier', async () => {
    const { path, store } = setup();
    const items = new Set(['a']);
    await store.choose({ key: 'lardon', label: 'Lardons', product: product('2'), role: 'fallback' }, by);
    await store.choose({ key: 'lardon', label: 'Lardons', product: product('1'), role: 'preferred' }, by);
    await store.putInBasket('coursesu', { itemId: 'a', key: 'lardon', label: 'Lardons', product: { id: '1', name: '', url: '' }, count: 1, per: null }, items, by);
    let basket = await store.markMissing({ enseigne: 'coursesu', itemId: 'a', key: 'lardon', productId: '1', source: 'extension' }, items, by);
    expect(basket?.missing).toEqual([{ itemId: 'a', key: 'lardon', unavailable: ['1'], replacement: null, source: 'extension', at: fixedClock().toISOString(), by }]);
    expect(basket?.lines).toEqual([]);
    expect((await store.choices())[0].preferred?.missingAt).toBe(fixedClock().toISOString());
    expect((await store.setReplacement('a', '2', items))?.missing[0].replacement).toBe('2');
    expect(await store.setReplacement('b', '2', items)).toBeNull();
    // Le remplacement aussi en rupture : il ne l'est plus, et rejoint les indisponibles.
    basket = await store.markMissing({ enseigne: 'coursesu', itemId: 'a', key: 'lardon', productId: '2', source: 'manual' }, items, by);
    expect(basket?.missing[0]).toMatchObject({ unavailable: ['1', '2'], replacement: null, source: 'manual' });
    expect((await createDriveStore({ path, clock: fixedClock }).basket())?.missing).toHaveLength(1);
    // Reparti au panier : la trace s'efface ; retirer le signalement efface celle des autres produits.
    await store.putInBasket('coursesu', { itemId: 'a', key: 'lardon', label: 'Lardons', product: { id: '1', name: '', url: '' }, count: 1, per: null }, items, by);
    expect((await store.choices())[0].preferred?.missingAt).toBeNull();
    expect((await store.choices())[0].fallback[0].missingAt).not.toBeNull();
    expect((await store.unmarkMissing('a', items))?.missing).toEqual([]);
    expect((await store.choices())[0].fallback[0].missingAt).toBeNull();
    // Article parti de la liste : son signalement s'en va à l'écriture suivante.
    await store.markMissing({ enseigne: 'coursesu', itemId: 'a', key: 'lardon', productId: '1', source: 'manual' }, items, by);
    expect((await store.putInBasket('coursesu', { itemId: 'b', key: 'b', label: 'b', product: null, count: 1, per: null }, new Set(['b']), by))?.missing).toEqual([]);
  });

  it('relit un panier sans signalements (étapes 2 et 3)', async () => {
    const { path } = setup();
    writeFileSync(path, JSON.stringify({ version: 1, settings: { enseigne: 'coursesu', store: null }, choices: [], basket: { enseigne: 'coursesu', startedAt: '', startedBy: by, lines: [] } }));
    expect((await createDriveStore({ path, clock: fixedClock }).basket())?.missing).toEqual([]);
  });

  it('fiche lue par l’extension : prix noté, EAN gardé seulement s’il manquait ; il suit le produit qui change de rôle', async () => {
    const { path, store } = setup();
    await store.choose({ key: 'lardon', label: 'Lardons', product: product('1'), role: 'preferred' }, by);
    expect(await store.notePage('lardon', 'coursesu', '1', { price: 2.35, ean: '2000000000015' })).toEqual({ price: true, ean: 'set' });
    expect(await store.notePage('lardon', 'coursesu', '1', { price: null, ean: '2000000000022' })).toEqual({ price: false, ean: 'other' });
    expect(await store.notePage('lardon', 'coursesu', '9', { price: 1, ean: null })).toBeNull();
    const reread = createDriveStore({ path, clock: fixedClock });
    expect((await reread.choices())[0].preferred).toMatchObject({ ean: '2000000000015', price: { value: 2.35, at: fixedClock().toISOString() } });
    // Un autre produit retenu : l'ancien devient un secours avec son prix ; le reprendre ne l'efface pas.
    await reread.choose({ key: 'lardon', label: 'Lardons', product: product('2'), role: 'preferred' }, by);
    const back = await reread.choose({ key: 'lardon', label: 'Lardons', product: product('1'), role: 'preferred' }, by);
    expect(back?.preferred?.price?.value).toBe(2.35);
  });
});
