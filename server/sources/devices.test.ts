import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOW } from '../testing.ts';
import { createDeviceStore, PAIRING_CODE_TTL_MS } from './devices.ts';

function setup() {
  let now = NOW;
  const path = join(mkdtempSync(join(tmpdir(), 'homehub-devices-')), 'devices.json');
  return { store: createDeviceStore({ path, clock: () => now }), path, setNow: (date: Date) => (now = date) };
}

describe('téléphones', () => {
  it('un code, un seul téléphone, lié au profil du code', async () => {
    const { store, path } = setup();
    const { code } = store.createCode('tom');
    const paired = await store.claim(code, 'Pixel 8');
    expect(paired?.device).toMatchObject({ ownerId: 'tom', name: 'Pixel 8' });
    expect(await store.claim(code, 'Autre')).toBeNull();

    expect(await store.authenticate(paired!.token)).toMatchObject({ ownerId: 'tom' });
    expect(await store.authenticate('faux')).toBeNull();
    // Seule l'empreinte du jeton est enregistrée.
    expect(await readFile(path, 'utf8')).not.toContain(paired!.token);
  });

  it('code expiré ou remplacé : refusé', async () => {
    const { store, setNow } = setup();
    const first = store.createCode('tom');
    const second = store.createCode('lea');
    expect(await store.claim(first.code, 'A')).toBeNull();
    setNow(new Date(NOW.getTime() + PAIRING_CODE_TTL_MS + 1));
    expect(await store.claim(second.code, 'B')).toBeNull();
  });

  it('téléphone retiré : son jeton ne vaut plus rien', async () => {
    const { store } = setup();
    const paired = await store.claim(store.createCode('tom').code, 'Pixel 8');
    expect(await store.remove(paired!.device.id)).toBe(true);
    expect(await store.authenticate(paired!.token)).toBeNull();
    expect(await store.list()).toEqual([]);
  });
});
