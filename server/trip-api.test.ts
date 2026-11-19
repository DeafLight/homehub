// Tests des routes du « Prochain trajet » et des notifications : le téléphone de la personne seulement (son profil,
// jamais celui d'un autre), ni la tablette ni un appareil non appairé ; position lue dans le corps ; abonnement Web
// Push rattaché au téléphone, notification d'essai. Version 2.1 : rendez-vous touchables et trajet d'un rendez-vous
// (le téléphone pour lui-même et la famille, la tablette sans position), diagnostic de la notification. Version 4 :
// positions réelles des véhicules, seulement ceux des courses demandées, jamais tout le flux.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LatLon, NextTrip, TripRoute } from '../shared/trip.ts';
import { createAccess, kioskKeyMatcher, OWN_PHONE_ONLY } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createRouter } from './http.ts';
import { createPushApi } from './push-api.ts';
import type { NextTripService, TripOptions, TripViewer } from './services/next-trip.ts';
import type { PushMessage } from './services/web-push.ts';
import type { GtfsRtVehicle } from './sources/gtfs-rt.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createPushStore, type PushRecord } from './sources/push.ts';
import { createTripApi } from './trip-api.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const SUB = { endpoint: 'https://push.exemple.test/abc', keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) } };

/** Flux de positions d'exemple : un tram de la course demandée (au format MOTIS), un bus d'une autre course. */
const FEED: GtfsRtVehicle[] = [
  { tripId: 'FICTIF-A-1', lat: 47.4765, lon: -0.5487, bearing: 90, timestamp: NOW.getTime() / 1000 - 25, stopId: 'JEXE', status: 'stopped' },
  { tripId: 'FICTIF-3-9', lat: 47.469, lon: -0.553, timestamp: NOW.getTime() / 1000 - 5 },
];

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
  const eventCalls: { viewer: TripViewer; key: string; position: LatLon | null }[] = [];
  const routableCalls: { viewer: TripViewer; week: number }[] = [];
  const rideCalls: string[] = [];
  const nextTrip: NextTripService = {
    enabled: () => enabled,
    destination: async (ownerId) => (ownerId === 'lea' ? { destination: { kind: 'course', title: 'Maths', start: NOW.toISOString(), place: 'Collège', lat: 47.48, lon: -0.55 }, margin: 10 } : null),
    plan: async (ownerId, position, options) => {
      calls.push({ ownerId, position, options });
      return { destination: { title: ownerId } } as unknown as NextTrip;
    },
    route: async (ownerId, position) => {
      calls.push({ ownerId, position });
      return { destination: { title: ownerId } } as unknown as TripRoute;
    },
    rides: async (refs) => (rideCalls.push(...refs.map((r) => r.tripId)), refs.map(() => null)),
    routable: async (viewer, week) => (routableCalls.push({ viewer, week }), ['rdv@2026-11-05T09:00:00.000Z']),
    planEvent: async (viewer, key, position) => (eventCalls.push({ viewer, key, position }), { trip: null, missing: 'here' }),
    watch: async (ownerId) => ({ enabled: true, next: null, unplaced: [{ title: ownerId, start: NOW.toISOString(), location: 'chez Mamie', reason: 'not-found' }] }),
  };
  const push = createPushStore({ path: join(dir, 'push.json'), keysPath: join(dir, 'push-vapid.json'), clock });
  await push.load();
  const sent: { sub: PushRecord; message: PushMessage }[] = [];
  const api = createRouter();
  let feedReads = 0;
  const vehicles = { vehicles: async () => (feedReads++, FEED) };
  api.route('/', createTripApi({ nextTrip, access, vehicles, clock }));
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
  return { call, phone, calls, eventCalls, routableCalls, rideCalls, sent, push, devices, feedReads: () => feedReads };
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

describe('API de la carte en route', () => {
  it('itinéraire du téléphone pour lui-même seulement, position lue dans le corps', async () => {
    const { call, phone, calls } = await setup();
    const alex = await phone('alex');
    const res = await call('POST', '/trip/route', { token: alex, body: { ownerId: 'lea', position: { lat: 47.46, lon: -0.55 } } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ enabled: true, route: { destination: { title: 'alex' } } });
    expect(calls).toEqual([{ ownerId: 'alex', position: { lat: 47.46, lon: -0.55 } }]);
  });

  it('nouvelles heures des courses suivies, au plus quatre', async () => {
    const { call, phone, rideCalls } = await setup();
    const lea = await phone('lea');
    const stop = { name: 'Ralliement', lat: 47.4668, lon: -0.557, stopId: 'irigo_RALL' };
    const ride = (tripId: string) => ({ tripId, from: stop, to: { ...stop, name: 'Mail des Tilleuls' } });
    expect(await (await call('POST', '/trip/rides', { token: lea, body: { rides: [ride('a'), ride('b')] } })).json()).toEqual({ rides: [null, null] });
    expect(rideCalls).toEqual(['a', 'b']);
    expect((await call('POST', '/trip/rides', { token: lea, body: { rides: ['a', 'b', 'c', 'd', 'e'].map(ride) } })).status).toBe(400);
  });

  it('positions réelles : seulement les véhicules des courses demandées, avec leur âge', async () => {
    const { call, phone } = await setup();
    const lea = await phone('lea');
    const res = await call('POST', '/trip/vehicles', { token: lea, body: { tripIds: ['20261105_07:42_irigo_FICTIF-A-1', 'absente'] } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      vehicles: [{ tripId: '20261105_07:42_irigo_FICTIF-A-1', lat: 47.4765, lon: -0.5487, bearing: 90, age: 25, stopId: 'JEXE', status: 'stopped' }],
    });
  });

  it('positions réelles : sans course demandée, le flux n’est pas lu ; au plus quatre courses ; téléphone appairé seulement', async () => {
    const { call, phone, feedReads } = await setup();
    const lea = await phone('lea');
    expect(await (await call('POST', '/trip/vehicles', { token: lea, body: { tripIds: [] } })).json()).toEqual({ vehicles: [] });
    expect(feedReads()).toBe(0);
    expect((await call('POST', '/trip/vehicles', { token: lea, body: { tripIds: ['a', 'b', 'c', 'd', 'e'] } })).status).toBe(400);
    expect((await call('POST', '/trip/vehicles', { from: TABLET, body: { tripIds: ['FICTIF-3-9'] } })).status).toBe(403);
    expect((await call('POST', '/trip/vehicles', { body: { tripIds: ['FICTIF-3-9'] } })).status).toBe(403);
    expect((await call('POST', '/trip/vehicles', { token: 'inconnu', body: { tripIds: ['FICTIF-3-9'] } })).status).toBe(401);
    expect(feedReads()).toBe(0);
  });

  it('ni la tablette, ni un appareil non appairé ; sans MOTIS, pas d’itinéraire', async () => {
    const { call } = await setup();
    expect((await call('POST', '/trip/route', { from: TABLET, body: {} })).status).toBe(403);
    expect((await call('POST', '/trip/rides', { body: { rides: [] } })).status).toBe(403);
    const off = await setup({ enabled: false });
    const lea = await off.phone('lea');
    expect(await (await off.call('POST', '/trip/route', { token: lea, body: {} })).json()).toEqual({ enabled: false, route: null });
  });
});

describe('API des rendez-vous touchés', () => {
  it('téléphone : pour lui-même (profil jamais pris de la requête), position transmise', async () => {
    const { call, phone, eventCalls, routableCalls } = await setup();
    const alex = await phone('alex');
    expect(await (await call('GET', '/trip/events?week=1&ownerId=lea', { token: alex })).json()).toEqual({ keys: ['rdv@2026-11-05T09:00:00.000Z'] });
    expect(routableCalls).toEqual([{ viewer: { phone: 'alex' }, week: 1 }]);
    const res = await call('POST', '/trip/event', { token: alex, body: { event: 'rdv@x', ownerId: 'lea', position: { lat: 47.46, lon: -0.55 } } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ enabled: true, trip: null, missing: 'here' });
    expect(eventCalls).toEqual([{ viewer: { phone: 'alex' }, key: 'rdv@x', position: { lat: 47.46, lon: -0.55 } }]);
  });

  it('tablette : tous les profils, position ignorée ; ni un appareil non appairé, ni une semaine hors limites', async () => {
    const { call, eventCalls, routableCalls } = await setup();
    expect((await call('GET', '/trip/events', { from: TABLET })).status).toBe(200);
    expect(routableCalls).toEqual([{ viewer: { tablet: true }, week: 0 }]);
    await call('POST', '/trip/event', { from: TABLET, body: { event: 'rdv@x', position: { lat: 47.46, lon: -0.55 } } });
    expect(eventCalls).toEqual([{ viewer: { tablet: true }, key: 'rdv@x', position: null }]);
    expect((await call('GET', '/trip/events')).status).toBe(403);
    expect((await call('POST', '/trip/event', { body: { event: 'rdv@x' } })).status).toBe(403);
    expect((await call('GET', '/trip/events', { token: 'inconnu' })).status).toBe(401);
    expect((await call('GET', '/trip/events?week=9', { from: TABLET })).status).toBe(400);
    expect((await call('POST', '/trip/event', { from: TABLET, body: {} })).status).toBe(400);
  });

  it('diagnostic : le téléphone de la personne seulement', async () => {
    const { call, phone } = await setup();
    const lea = await phone('lea');
    expect(await (await call('GET', '/trip/watch', { token: lea })).json()).toMatchObject({ unplaced: [{ title: 'lea' }] });
    expect((await call('GET', '/trip/watch', { from: TABLET })).status).toBe(403);
  });

  it('sans MOTIS : rien de touchable', async () => {
    const { call, phone, routableCalls } = await setup({ enabled: false });
    const lea = await phone('lea');
    expect(await (await call('GET', '/trip/events', { token: lea })).json()).toEqual({ keys: [] });
    expect(await (await call('POST', '/trip/event', { token: lea, body: { event: 'rdv@x' } })).json()).toEqual({ enabled: false, trip: null });
    expect(routableCalls).toEqual([]);
  });
});

describe('API des notifications', () => {
  it('abonne ce téléphone, envoie un essai, désabonne', async () => {
    const { call, phone, sent, push } = await setup();
    const lea = await phone('lea');
    const status = await (await call('GET', '/push', { token: lea })).json();
    expect(status).toEqual({ publicKey: push.keys().publicKey, subscribed: false, prefs: { trips: true, notes: true } });
    expect((await call('POST', '/push/test', { token: lea })).status).toBe(409);
    expect((await call('PUT', '/push', { token: lea, body: SUB })).status).toBe(200);
    expect((await push.all()).map((s) => s.ownerId)).toEqual(['lea']);
    expect(await (await call('POST', '/push/test', { token: lea })).json()).toEqual({ ok: true });
    expect(sent[0].sub.endpoint).toBe(SUB.endpoint);
    expect(await (await call('DELETE', '/push', { token: lea })).json()).toMatchObject({ subscribed: false });
    expect(await push.all()).toEqual([]);
  });

  it('réglages du téléphone : « Nouveaux mots » coupé puis remis, gardés à part de l’abonnement', async () => {
    const { call, phone } = await setup();
    const lea = await phone('lea');
    const off = await (await call('PUT', '/push/prefs', { token: lea, body: { notes: false } })).json();
    expect(off.prefs).toEqual({ trips: true, notes: false });
    await call('PUT', '/push', { token: lea, body: SUB });
    expect((await (await call('GET', '/push', { token: lea })).json()).prefs).toEqual({ trips: true, notes: false });
    expect((await (await call('PUT', '/push/prefs', { token: lea, body: { notes: true } })).json()).prefs.notes).toBe(true);
    expect((await call('PUT', '/push/prefs', { token: lea, body: { notes: 'oui' } })).status).toBe(400);
    expect((await call('PUT', '/push/prefs', { from: TABLET, body: { notes: false } })).status).toBe(403);
  });

  it('refuse un abonnement mal formé, la tablette et un appareil non appairé', async () => {
    const { call, phone } = await setup();
    const lea = await phone('lea');
    expect((await call('PUT', '/push', { token: lea, body: { endpoint: 'http://x' } })).status).toBe(400);
    expect((await call('GET', '/push', { from: TABLET })).status).toBe(403);
    expect((await call('PUT', '/push', { body: SUB })).status).toBe(403);
  });
});
