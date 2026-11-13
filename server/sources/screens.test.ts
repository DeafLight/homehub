// Tests du magasin des télés appairées : code sans ambiguïté, tapé à peu près, jeton donné une seule fois et
// enregistré haché, code expiré, télé retirée.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_CODE_ALPHABET } from '../../shared/screen.ts';
import { createScreenStore, normalizeCode, SCREEN_CODE_TTL_MS } from './screens.ts';

function setup() {
  let now = new Date(2026, 10, 2, 18, 0).getTime();
  const path = join(mkdtempSync(join(tmpdir(), 'homehub-screens-')), 'screens.json');
  const store = createScreenStore({ path, clock: () => new Date(now) });
  return { store, path, advance: (ms: number) => (now += ms) };
}

describe('Télés appairées', () => {
  it('code de 6 caractères sans ambiguïté ; tapé en minuscules avec espace, il est reconnu', async () => {
    const { store } = setup();
    const { id, code } = store.startPairing({ system: 'Android 10', app: '0.69.0' });
    expect(code).toMatch(new RegExp(`^[${SCREEN_CODE_ALPHABET}]{6}$`));
    expect(normalizeCode(' ab-c d ')).toBe('ABCD');
    expect(await store.pairing(id, 0)).toEqual({ status: 'pending' });

    const typed = `${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`;
    const screen = await store.confirm(typed, 'Télé du salon');
    expect(screen).toMatchObject({ name: 'Télé du salon', system: 'Android 10', app: '0.69.0' });
  });

  it('le jeton est donné une seule fois, enregistré haché, et reconnaît la télé', async () => {
    const { store, path } = setup();
    const { id, code } = store.startPairing({ system: null, app: null });
    const waiting = store.pairing(id, 5_000);
    await store.confirm(code, 'Télé');
    const state = await waiting;
    if (state?.status !== 'paired') throw new Error('télé non appairée');
    expect(await store.pairing(id, 0)).toBeNull();
    expect(readFileSync(path, 'utf8')).not.toContain(state.token);
    expect((await store.authenticate(state.token))?.id).toBe(state.screen.id);
    expect(await store.authenticate('autre')).toBeNull();
    // Un code déjà utilisé ne sert pas deux fois.
    expect(await store.confirm(code, 'Autre')).toBeNull();
  });

  it('code expiré : refusé, et la demande est oubliée', async () => {
    const { store, advance } = setup();
    const { id, code } = store.startPairing({ system: null, app: null });
    advance(SCREEN_CODE_TTL_MS);
    expect(await store.confirm(code, 'Télé')).toBeNull();
    expect(await store.pairing(id, 0)).toBeNull();
  });

  it('renommée puis retirée : son jeton ne vaut plus rien', async () => {
    const { store } = setup();
    const { id, code } = store.startPairing({ system: null, app: null });
    await store.confirm(code, 'Télé');
    const state = await store.pairing(id, 0);
    if (state?.status !== 'paired') throw new Error('télé non appairée');
    expect((await store.rename(state.screen.id, 'Salon'))?.name).toBe('Salon');
    expect(await store.remove(state.screen.id)).toBe(true);
    expect(await store.authenticate(state.token)).toBeNull();
    expect(await store.list()).toEqual([]);
  });
});
