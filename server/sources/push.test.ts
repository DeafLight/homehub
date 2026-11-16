// Tests du magasin des notifications : clés VAPID générées une fois puis relues, abonnement par téléphone, trajets
// annoncés une seule fois (même après relecture du fichier), oubliés au bout de deux jours.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOW } from '../testing.ts';
import { createPushStore, subscriptionSchema } from './push.ts';

const SUB = { endpoint: 'https://push.exemple.test/abc', keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) } };

function setup(dir = mkdtempSync(join(tmpdir(), 'homehub-push-'))) {
  let now = NOW.getTime();
  const store = createPushStore({ path: join(dir, 'push.json'), keysPath: join(dir, 'push-vapid.json'), clock: () => new Date(now) });
  return { store, dir, advance: (ms: number) => (now += ms) };
}

describe('magasin des notifications', () => {
  it('génère les clés VAPID une fois, dans le dossier d’état, puis les relit', async () => {
    const { store, dir } = setup();
    await store.load();
    const keys = store.keys();
    expect(keys.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/u);
    expect(JSON.parse(readFileSync(join(dir, 'push-vapid.json'), 'utf8')).privateKey).toBe(keys.privateKey);
    const again = setup(dir).store;
    await again.load();
    expect(again.keys()).toEqual(keys);
  });

  it('un abonnement par téléphone, retiré à la demande', async () => {
    const { store } = setup();
    await store.subscribe('tel-1', 'alex', SUB);
    await store.subscribe('tel-1', 'alex', { ...SUB, endpoint: 'https://push.exemple.test/def' });
    expect(await store.all()).toEqual([{ deviceId: 'tel-1', ownerId: 'alex', ...SUB, endpoint: 'https://push.exemple.test/def' }]);
    await store.unsubscribe('tel-1');
    expect(await store.get('tel-1')).toBeNull();
  });

  it('un trajet annoncé une seule fois, oublié au bout de deux jours', async () => {
    const { store, dir, advance } = setup();
    expect(await store.markSent('matin|lea|2026-11-02')).toBe(true);
    expect(await store.markSent('matin|lea|2026-11-02')).toBe(false);
    expect(await setup(dir).store.markSent('matin|lea|2026-11-02')).toBe(false);
    advance(3 * 24 * 3_600_000);
    await store.markSent('autre');
    expect(await store.markSent('matin|lea|2026-11-02')).toBe(true);
  });

  it('refuse un abonnement qui n’est pas en https ou dont les clés sont mal formées', () => {
    expect(subscriptionSchema.safeParse(SUB).success).toBe(true);
    expect(subscriptionSchema.safeParse({ ...SUB, endpoint: 'http://push.exemple.test/abc' }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ ...SUB, keys: { ...SUB.keys, auth: 'court' } }).success).toBe(false);
  });
});
