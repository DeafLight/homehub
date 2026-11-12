// Tests du magasin du drive : réglages, produit retenu et produits de secours (jamais pris d'office), retrait,
// relecture du fichier.
import { mkdtempSync } from 'node:fs';
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
});
