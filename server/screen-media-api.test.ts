// Tests de la fonction 6 (pause, reprise, volume) : commandes de la tablette par un parent reconnu ou le code parent,
// enfant et personne refusés, « À table ! » signé du parent ou de HomeHub, liste des télés sans rien de personnel, et
// volume fixe (barre de son) : touches de volume refusées à la tablette comme au téléphone, pause toujours permise.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_PROTOCOL_HEADER, type MediaScreens, type RemoteScreen, type ScreenEvents, type ScreenPairingStart, type ScreenPairingState, type ScreenStateReport } from '../shared/screen.ts';
import { createAccess, kioskKeyMatcher, REMOTE_PARENTS_ONLY } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createPinGate } from './pin-gate.ts';
import { createScreenApi } from './screen-api.ts';
import { createScreenMediaApi, PARENT_CODE_NEEDED } from './screen-media-api.ts';
import { VOLUME_FIXED } from './services/screen-media.ts';
import { createScreenHub, SCREEN_OFFLINE } from './services/screens.ts';
import { createVoiceMessages } from './services/voice-messages.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createPinStore, PARENT_PIN_ID } from './sources/pins.ts';
import { createScreenAppStore } from './sources/screen-apps.ts';
import { createScreenStore } from './sources/screens.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const TV = '192.168.1.60';
const PROTOCOL = { [SCREEN_PROTOCOL_HEADER]: '1' };

async function setup({ parentCode = true } = {}) {
  const clock = () => NOW;
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-screen-media-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const screens = createScreenStore({ path: join(dir, 'screens.json'), clock });
  const sessions = createActorSessions(clock);
  const pinStore = createPinStore({ path: join(dir, 'pins.json'), clock });
  if (parentCode) await pinStore.set(PARENT_PIN_ID, '2468');
  const access = createAccess({ config, devices, screens, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const hub = createScreenHub({ clock, waitMs: 30, reportMs: 2_000 });
  const household = createHousehold(config);
  const api = createRouter();
  const apps = createScreenAppStore({ path: join(dir, 'screen-apps.json'), clock });
  const voice = createVoiceMessages({ rules: () => config.current().cast, clock });
  api.route('/', createScreenApi({ screens, apps, hub, voice, config, household, access }));
  api.route('/', createScreenMediaApi({ screens, hub, household, access, pins: createPinGate(pinStore) }));

  type Options = { from?: string; token?: string; body?: unknown; headers?: Record<string, string> };
  const call = (method: string, path: string, { from = OTHER, token, body, headers }: Options = {}) =>
    api.request(
      path,
      { method, headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) },
      connectedFrom(from),
    );
  const tablet = (who: string | null = 'alex'): { from: string; headers: Record<string, string> } => ({ from: TABLET, headers: who ? { 'X-Actor-Session': sessions.open(who, 10).token } : {} });
  const { code } = devices.createCode('alex');
  const alex = (await devices.claim(code, 'Téléphone d’Alex'))!.token;

  // Une télé appairée, qui se signale (attente longue) puis répond à tout ce qu'elle reçoit.
  const start = (await (await call('POST', '/screen/pairing', { from: TV, headers: PROTOCOL, body: {} })).json()) as ScreenPairingStart;
  const waiting = call('GET', `/screen/pairing/${start.id}`, { from: TV, headers: PROTOCOL });
  await call('POST', '/screens', { ...tablet(), body: { code: start.code, name: 'Télé du salon' } });
  const paired = (await (await waiting).json()) as ScreenPairingState;
  if (paired.status !== 'paired') throw new Error('télé non appairée');
  const tv = { id: paired.screen.id, token: paired.token };
  const tvCall = (method: string, path: string, body?: unknown) => call(method, path, { from: TV, token: tv.token, headers: PROTOCOL, body });
  const setState = (volume?: ScreenStateReport['volume']) =>
    tvCall('POST', '/screen/state', { screenOn: true, foreground: 'fr.exemple.video', control: 'adb', addresses: [], ...(volume && { volume }) });

  const got: ScreenEvents['events'] = [];
  let stopped = true;
  const listen = () => {
    stopped = false;
    void (async () => {
      let after = '';
      while (!stopped) {
        const { events, last } = (await (await tvCall('GET', `/screen/events?after=${after}`)).json()) as ScreenEvents;
        after = String(last);
        for (const e of events) {
          got.push(e);
          await tvCall('POST', `/screen/events/${e.id}/report`, { ok: true });
        }
      }
    })();
  };
  return { call, tablet, alex, tv, setState, listen, got, stop: () => (stopped = true) };
}

const received = (got: ScreenEvents['events']) => got.map(({ seq: _s, id: _i, ...e }) => e);

describe('Pause, reprise et volume depuis la tablette', () => {
  it('liste des télés, sans l’appli en cours ; code parent défini ou non', async () => {
    const env = await setup();
    expect(await (await env.call('GET', '/screens/media', env.tablet(null))).json()).toEqual({
      screens: [{ id: env.tv.id, name: 'Télé du salon', power: 'offline', volume: null, control: null }],
      parentCode: true,
    } satisfies MediaScreens);
    env.listen();
    await env.setState('fixed');
    const body = (await (await env.call('GET', '/screens/media', env.tablet(null))).json()) as MediaScreens;
    expect(body.screens[0]).toEqual({ id: env.tv.id, name: 'Télé du salon', power: 'on', volume: 'fixed', control: 'adb' });
    expect(JSON.stringify(body)).not.toContain('fr.exemple.video');
    env.stop();
    // Ailleurs que sur la tablette : refusé.
    expect((await env.call('GET', '/screens/media', { token: env.alex })).status).toBe(403);
    expect(((await (await (await setup({ parentCode: false })).call('GET', '/screens/media', { from: TABLET })).json()) as MediaScreens).parentCode).toBe(false);
  });

  it('parent reconnu ou code parent : pause, reprise, volume et « À table ! » partent à la télé', async () => {
    const env = await setup();
    env.listen();
    await env.setState('adjustable');
    for (const action of ['pause', 'play', 'volup', 'voldown', 'mute']) {
      expect(await (await env.call('POST', `/screens/${env.tv.id}/media`, { ...env.tablet(), body: { action } })).json()).toEqual({ ok: true });
    }
    expect((await env.call('POST', `/screens/${env.tv.id}/media`, { ...env.tablet(), body: { action: 'dinner' } })).status).toBe(200);
    expect((await env.call('POST', `/screens/${env.tv.id}/media`, { ...env.tablet(null), body: { action: 'dinner', pin: '2468' } })).status).toBe(200);
    env.stop();
    expect(received(env.got)).toEqual([
      { kind: 'key', keys: ['pause'] },
      { kind: 'key', keys: ['play'] },
      { kind: 'key', keys: ['volup'] },
      { kind: 'key', keys: ['voldown'] },
      { kind: 'key', keys: ['mute'] },
      { kind: 'key', keys: ['pause'], notice: { title: 'À table !', subtitle: 'De la part d’Alex' } },
      { kind: 'key', keys: ['pause'], notice: { title: 'À table !', subtitle: 'HomeHub' } },
    ]);
  });

  it('enfant reconnu, personne, mauvais code, téléphone : refusés', async () => {
    const env = await setup();
    const media = (options: object, body: object) => env.call('POST', `/screens/${env.tv.id}/media`, { ...options, body });
    expect(await (await media(env.tablet('lea'), { action: 'pause' })).json()).toEqual({ error: REMOTE_PARENTS_ONLY });
    expect(await (await media(env.tablet(null), { action: 'pause' })).json()).toEqual({ error: PARENT_CODE_NEEDED });
    expect((await media(env.tablet(null), { action: 'pause', pin: '0000' })).status).toBe(403);
    expect((await media({ token: env.alex }, { action: 'pause' })).status).toBe(403);
    expect((await media(env.tablet(), { action: 'avance' })).status).toBe(400);
    // Le code d'un enfant reconnu… passe s'il est le bon code parent (un parent à côté de lui).
    expect((await media(env.tablet('lea'), { action: 'pause', pin: '2468' })).status).toBe(503);
  });

  it('sans code parent défini, le code ne sert à rien ; télé injoignable : 503', async () => {
    const env = await setup({ parentCode: false });
    expect((await env.call('POST', `/screens/${env.tv.id}/media`, { ...env.tablet(null), body: { action: 'pause', pin: '2468' } })).status).toBe(403);
    expect(await (await env.call('POST', `/screens/${env.tv.id}/media`, { ...env.tablet(), body: { action: 'pause' } })).json()).toEqual({ error: SCREEN_OFFLINE });
    expect((await env.call('POST', '/screens/inconnue/media', { ...env.tablet(), body: { action: 'pause' } })).status).toBe(404);
  });

  it('volume fixe (barre de son) : volume refusé à la tablette et au téléphone, la pause passe', async () => {
    const env = await setup();
    env.listen();
    await env.setState('fixed');
    expect(await (await env.call('POST', `/screens/${env.tv.id}/media`, { ...env.tablet(), body: { action: 'volup' } })).json()).toEqual({ error: VOLUME_FIXED });
    expect((await env.call('POST', `/screens/${env.tv.id}/keys`, { token: env.alex, body: { keys: ['mute'] } })).status).toBe(409);
    expect((await env.call('POST', `/screens/${env.tv.id}/keys`, { token: env.alex, body: { keys: ['pause'] } })).status).toBe(200);
    expect((await env.call('POST', `/screens/${env.tv.id}/media`, { ...env.tablet(), body: { action: 'pause' } })).status).toBe(200);
    const [remote] = (await (await env.call('GET', '/screens/remote', { token: env.alex })).json()) as RemoteScreen[];
    expect(remote.volume).toBe('fixed');
    env.stop();
    expect(received(env.got)).toEqual([{ kind: 'key', keys: ['pause'] }, { kind: 'key', keys: ['pause'] }]);
  });
});
