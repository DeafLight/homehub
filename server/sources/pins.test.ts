import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOW } from '../testing.ts';
import { createPinStore, MAX_PIN_FAILURES, PARENT_PIN_ID, PIN_LOCK_MS } from './pins.ts';

function setup() {
  let now = NOW;
  const path = join(mkdtempSync(join(tmpdir(), 'homehub-pins-')), 'pins.json');
  const store = createPinStore({ path, clock: () => now });
  return { store, path, wait: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe('codes PIN', () => {
  it('enregistrés sous forme d’empreinte, vérifiés, supprimés', async () => {
    const { store, path } = setup();
    expect(await store.protectedIds()).toEqual([]);
    await store.set('alex', '482193');
    expect(await readFile(path, 'utf8')).not.toContain('482193');
    expect(await store.protectedIds()).toEqual(['alex']);
    expect(await store.check(['alex'], '482193')).toEqual({ ok: true });
    expect(await store.check(['alex'], '482194')).toEqual({ ok: false, reason: 'wrong' });
    await expect(store.set('alex', '12')).rejects.toThrow(/4 à 8 chiffres/);
    expect(await store.remove('alex')).toBe(true);
    expect(await store.remove('alex')).toBe(false);
  });

  it('bloqué après trop d’erreurs, puis de nouveau utilisable', async () => {
    const { store, wait } = setup();
    await store.set('alex', '4821');
    for (let i = 1; i < MAX_PIN_FAILURES; i++) expect((await store.check(['alex'], '0000')).ok).toBe(false);
    expect(await store.check(['alex'], '0000')).toEqual({ ok: false, reason: 'locked', waitMs: PIN_LOCK_MS });
    wait(PIN_LOCK_MS - 60_000);
    expect(await store.check(['alex'], '4821')).toEqual({ ok: false, reason: 'locked', waitMs: 60_000 });
    wait(60_000);
    expect(await store.check(['alex'], '4821')).toEqual({ ok: true });
  });

  it('plusieurs codes acceptés : une erreur compte pour chacun, un code bloqué laisse l’autre utilisable', async () => {
    const { store } = setup();
    await store.set('alex', '4821');
    await store.set(PARENT_PIN_ID, '9753');
    const both = ['alex', PARENT_PIN_ID];
    expect(await store.check(both, '4821')).toEqual({ ok: true });
    expect(await store.check(both, '9753')).toEqual({ ok: true });
    // Le PIN d'Alex se bloque ; le code parent, essayé moins souvent, reste utilisable.
    for (let i = 0; i < MAX_PIN_FAILURES; i++) await store.check(['alex'], '0000');
    expect(await store.check(both, '4821')).toEqual({ ok: false, reason: 'wrong' });
    expect(await store.check(both, '9753')).toEqual({ ok: true });
  });
});
