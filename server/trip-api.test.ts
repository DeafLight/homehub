// Tests des routes du « Prochain trajet » et des notifications : le téléphone de la personne seulement (son profil,
// jamais celui d'un autre), ni la tablette ni un appareil non appairé ; position lue dans le corps ; abonnement Web
// Push rattaché au téléphone, notification d'essai.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LatLon, NextTrip } from '../shared/trip.ts';
import { createAccess, kioskKeyMatcher, OWN_PHONE_ONLY } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createRouter } from './http.ts';
import { createPushApi } from './push-api.ts';
import type { NextTripService, TripOptions } from './services/next-trip.ts';
import type { PushMessage } from './services/web-push.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createPushStore, type PushRecord } from './sources/push.ts';
import { createTripApi } from './trip-api.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const SUB = { endpoint: 'https://push.exemple.test/abc', keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) } };

async function setup({ enabled = true, sendResult = 'sent' as const } = {}) {
  const clock = () => new Date(NOW);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-trip-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: () => null });
  const calls: { ownerId: string; position: LatLon | null; options?: TripOptions }[] = [];
  const nextTrip: NextTripService = {
    enabled: () => enabled,
    destination: async (ownerId) => (ownerId === 'lea' ? { destination: { kind: 'course', title: 'Maths', start: NOW.toISOString(), place: 'Collège', lat: 47.48, lon: -0.55 }, margin: 10 } : null),
    plan: async (ownerId, position, options) => {
      calls.push({ ownerId, position, options });
      return { destination: { title: ownerId } } as unknown as NextTrip;
    },
  };
  const push = createPushStore({ path: join(dir, 'push.json'), keysPath: join(dir, 'push-vapid.json'), clock });
  await push.load();
  const sent: { sub: PushRecord; message: PushMessage }[] = [];
  const api = createRouter();
  api.route('/', createTripApi({ nextTrip, access }));
  api.route('/', createPushApi({ store: push, access, send: async (sub, message) => (sent.push({ sub, message }), sendResult) }));
  const phone = async (ownerId: string) => {
    const { code } = devices.createCode(ownerId);
    return (await devices.claim(code, 'Téléphone'))!.token;
  };
  const call = (method: string, path: string, { token, body, from = '192.168.1.60' }: { token?: string; body?: unknown; from?: string } = {}) =>
    api.request(
      path,
      { method, headers: { ...(token && { Authorization: `Bearer ${token}` }), 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) },
      connectedFrom(from),
    );
  return { call, phone, calls, sent, push, devices };
}

describe('API du prochain trajet', () => {
  it('le téléphone ne demande que son trajet, position lue dans le corps, ligne voiture demandée', async () => {
    const { call, phone, calls } = await setup();
    const lea = await phone('lea');
    expect(await (await call('GET', '/trip', { token: lea })).json()).toEqual({ enabled: true, upcoming: true });
    const res = await call('POST', '/trip', { token: lea, body: { position: { lat: 47.46, lon: -0.55 } } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ enabled: true, trip: { destination: { title: 'lea' } } });
    expect(calls).toEqual([{ ownerId: 'lea', position: { lat: 47.46, lon: -0.55 }, options: { car: true } }]);
  });

  it('un parent ne reçoit que le sien : la route ne prend aucun profil', async () => {
    const { call, phone, calls } = await setup();
    const alex = await phone('alex');
    expect(await (await call('GET', '/trip?ownerId=lea', { token: alex })).json()).toEqual({ enabled: true, upcoming: false });
    await call('POST', '/trip', { token: alex, body: { ownerId: 'lea', position: null } });
    expect(calls.map((c) => c.ownerId)).toEqual(['alex']);
  });

  it('position absente ou illisible : depuis la maison', async () => {
    const { call, phone, calls } = await setup();
    const lea = await phone('lea');
    await call('POST', '/trip', { token: lea, body: {} });
    await call('POST', '/trip', { token: lea, body: { position: { lat: 'x' } } });
    expect(calls.map((c) => c.position)).toEqual([null, null]);
  });

  it('ni la tablette, ni un appareil non appairé', async () => {
    const { call } = await setup();
    expect(await (await call('GET', '/trip', { from: TABLET })).json()).toEqual({ error: OWN_PHONE_ONLY });
    expect((await call('POST', '/trip', { body: {} })).status).toBe(403);
    expect((await call('POST', '/trip', { token: 'inconnu', body: {} })).status).toBe(401);
  });

  it('sans MOTIS : rien à demander', async () => {
    const { call, phone, calls } = await setup({ enabled: false });
    const lea = await phone('lea');
    expect(await (await call('GET', '/trip', { token: lea })).json()).toEqual({ enabled: false, upcoming: false });
    expect(await (await call('POST', '/trip', { token: lea, body: {} })).json()).toEqual({ enabled: false, trip: null });
    expect(calls).toEqual([]);
  });
});

describe('API des notifications', () => {
  it('abonne ce téléphone, envoie un essai, désabonne', async () => {
    const { call, phone, sent, push } = await setup();
    const lea = await phone('lea');
    const status = await (await call('GET', '/push', { token: lea })).json();
    expect(status).toEqual({ publicKey: push.keys().publicKey, subscribed: false });
    expect((await call('POST', '/push/test', { token: lea })).status).toBe(409);
    expect((await call('PUT', '/push', { token: lea, body: SUB })).status).toBe(200);
    expect((await push.all()).map((s) => s.ownerId)).toEqual(['lea']);
    expect(await (await call('POST', '/push/test', { token: lea })).json()).toEqual({ ok: true });
    expect(sent[0].sub.endpoint).toBe(SUB.endpoint);
    expect(await (await call('DELETE', '/push', { token: lea })).json()).toMatchObject({ subscribed: false });
    expect(await push.all()).toEqual([]);
  });

  it('refuse un abonnement mal formé, la tablette et un appareil non appairé', async () => {
    const { call, phone } = await setup();
    const lea = await phone('lea');
    expect((await call('PUT', '/push', { token: lea, body: { endpoint: 'http://x' } })).status).toBe(400);
    expect((await call('GET', '/push', { from: TABLET })).status).toBe(403);
    expect((await call('PUT', '/push', { body: SUB })).status).toBe(403);
  });
});
