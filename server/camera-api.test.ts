// Tests des routes de la caméra en direct : réservée au téléphone d'un parent (ni enfant, ni tablette, ni appareil
// non appairé), la tablette seule écoute et répond, messages validés, fermeture sans erreur d'une diffusion finie ;
// le parent parle (signal `talk` relayé, refusé si `camera.talk` est coupé, jamais depuis le téléphone d'un enfant).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CameraMessages, CameraSession } from '../shared/camera.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { createCameraApi, PARENTS_ONLY, PHONE_ONLY } from './camera-api.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createLiveCamera } from './services/live-camera.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const CLIENT = 'page-tablette-1';

async function setup(camera: unknown = {}) {
  const clock = () => new Date(NOW);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
      camera,
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-camera-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const live = createLiveCamera({ clock, rules: () => config.current().camera, waitMs: 20 });
  const api = createRouter();
  api.route('/', createCameraApi({ camera: live, household: createHousehold(config), access }));

  const phone = async (ownerId: string) => {
    const { code } = devices.createCode(ownerId);
    return (await devices.claim(code, `Téléphone de ${ownerId}`))!.token;
  };
  const call = (method: string, path: string, { from = OTHER, token, body, headers }: { from?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    api.request(
      path,
      { method, headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) },
      connectedFrom(from),
    );
  const tabletListens = (after = '') => call('GET', `/camera/tablet/signals?client=${CLIENT}&after=${after}`, { from: TABLET });
  return { call, alex: await phone('alex'), lea: await phone('lea'), tabletListens, live, sessions };
}

describe('API caméra en direct : droits', () => {
  it('un enfant, un appareil non appairé, la tablette : refusés', async () => {
    const { call, lea, tabletListens, sessions } = await setup();
    await tabletListens();
    expect(await (await call('POST', '/camera/sessions', { token: lea })).json()).toEqual({ error: PARENTS_ONLY });
    expect((await call('POST', '/camera/sessions')).status).toBe(403);
    // Même avec un parent reconnu devant elle, la tablette ne se regarde pas elle-même.
    const { token } = sessions.open('alex', 10);
    const fromTablet = await call('POST', '/camera/sessions', { from: TABLET, headers: { 'X-Actor-Session': token } });
    expect(await fromTablet.json()).toEqual({ error: PHONE_ONLY });
  });

  it('seule la tablette écoute et répond', async () => {
    const { call, alex } = await setup();
    expect((await call('GET', `/camera/tablet/signals?client=${CLIENT}`, { token: alex })).status).toBe(403);
    expect((await call('POST', `/camera/tablet/sessions/x/signal?client=${CLIENT}`, { token: alex, body: { kind: 'answer', sdp: 'r' } })).status).toBe(403);
    expect((await call('GET', '/camera/tablet/signals', { from: TABLET })).status).toBe(400);
  });

  it('caméra désactivée : refusée au parent', async () => {
    const { call, alex, tabletListens } = await setup({ live: false });
    await tabletListens();
    expect((await call('POST', '/camera/sessions', { token: alex })).status).toBe(403);
  });
});

describe('API caméra en direct : échange complet', () => {
  it('ouverture, offre, réponse, fin', async () => {
    const { call, alex, lea, tabletListens } = await setup();
    expect((await call('POST', '/camera/sessions', { token: alex })).status).toBe(503);
    await tabletListens();
    const res = await call('POST', '/camera/sessions', { token: alex });
    expect(res.status).toBe(201);
    const session = (await res.json()) as CameraSession;
    expect(session).toMatchObject({ audio: true, talk: true, maxSeconds: 600, iceServers: [] });

    expect((await call('POST', `/camera/sessions/${session.id}/signal`, { token: alex, body: { kind: 'offer', sdp: 'v=0' } })).status).toBe(204);
    expect((await call('POST', `/camera/sessions/${session.id}/signal`, { token: alex, body: { kind: 'answer', sdp: 'v=0' } })).status).toBe(400);
    // Le téléphone d'un enfant ne lit pas la diffusion d'un parent.
    expect((await call('GET', `/camera/sessions/${session.id}/signals`, { token: lea })).status).toBe(403);

    const tablet = (await (await tabletListens('0')).json()) as CameraMessages;
    expect(tablet.messages.map((m) => m.signal.kind)).toEqual(['start', 'offer']);
    expect(tablet.messages[0].signal).toMatchObject({ viewerName: 'Alex' });
    const answer = await call('POST', `/camera/tablet/sessions/${session.id}/signal?client=${CLIENT}`, { from: TABLET, body: { kind: 'answer', sdp: 'v=0 r' } });
    expect(answer.status).toBe(204);

    const phone = (await (await call('GET', `/camera/sessions/${session.id}/signals?after=0`, { token: alex })).json()) as CameraMessages;
    expect(phone.messages.map((m) => m.signal)).toEqual([{ kind: 'answer', sdp: 'v=0 r' }]);

    expect((await call('DELETE', `/camera/sessions/${session.id}`, { token: alex })).status).toBe(204);
    // Déjà fermée : sans erreur.
    expect((await call('DELETE', `/camera/sessions/${session.id}`, { token: alex })).status).toBe(204);
    const bye = (await (await tabletListens('2')).json()) as CameraMessages;
    expect(bye.messages.map((m) => m.signal.kind)).toEqual(['bye']);
  });
});

describe('API caméra en direct : parler', () => {
  async function opened(camera: unknown = {}) {
    const s = await setup(camera);
    await s.tabletListens();
    const session = (await (await s.call('POST', '/camera/sessions', { token: s.alex })).json()) as CameraSession;
    const talk = (on: unknown, token = s.alex) => s.call('POST', `/camera/sessions/${session.id}/signal`, { token, body: { kind: 'talk', on } });
    return { ...s, session, talk };
  }

  it('le parent parle : relayé à la tablette', async () => {
    const { session, talk, tabletListens, lea } = await opened();
    expect(session.talk).toBe(true);
    expect((await talk(true)).status).toBe(204);
    expect((await talk('oui')).status).toBe(400);
    expect((await talk(false, lea)).status).toBe(403);
    const tablet = (await (await tabletListens('1')).json()) as CameraMessages;
    expect(tablet.messages.map((m) => m.signal)).toEqual([{ kind: 'talk', on: true }]);
  });

  it('camera.talk coupé : refusé', async () => {
    const { session, talk } = await opened({ talk: false });
    expect(session.talk).toBe(false);
    const res = await talk(true);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringContaining('camera.talk') });
  });
});
