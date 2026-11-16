// Tests des routes du mode film (fonction 15) : état vu de la télécommande et de la tablette, allumé tout seul par une
// appli de films (réglage du panneau Télés), allumé ou éteint à la main par un parent (téléphone, tablette avec
// parent reconnu ou code parent), enfant refusé, télé en veille ou injoignable ; message vocal lu sur le Google Home
// pendant un film, et le téléphone le dit.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScreenFilm } from '../shared/screen-film.ts';
import { SCREEN_PROTOCOL_HEADER, type MediaScreens, type RemoteScreen, type ScreenPairingStart, type ScreenPairingState } from '../shared/screen.ts';
import { createAccess, kioskKeyMatcher, REMOTE_PARENTS_ONLY } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createPinGate } from './pin-gate.ts';
import { createScreenAlertsApi } from './screen-alerts-api.ts';
import { createScreenApi } from './screen-api.ts';
import { createScreenMediaApi, FILM_SCREEN_STANDBY } from './screen-media-api.ts';
import type { CastMedia, CastTarget } from './services/cast.ts';
import { createScreenFallback } from './services/screen-fallback.ts';
import { createScreenFilm } from './services/screen-film.ts';
import { createScreenHub, SCREEN_OFFLINE } from './services/screens.ts';
import { createVoiceMessages } from './services/voice-messages.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createPinStore, PARENT_PIN_ID } from './sources/pins.ts';
import { createScreenAlertStore } from './sources/screen-alerts.ts';
import { createScreenAppStore } from './sources/screen-apps.ts';
import { createScreenFallbackStore } from './sources/screen-fallbacks.ts';
import { createScreenStore } from './sources/screens.ts';
import { createTimerStore } from './sources/timers.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const TV = '192.168.1.60';
const PROTOCOL = { [SCREEN_PROTOCOL_HEADER]: '1' };
const NETFLIX = 'com.netflix.ninja';

async function setup() {
  const clock = () => NOW;
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
      camera: { talk: true },
      cast: { mediaUrl: 'http://192.168.1.10:3010', devices: [{ id: 'salon', name: 'Google Home du salon', host: '192.168.1.30' }] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-screen-film-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const screens = createScreenStore({ path: join(dir, 'screens.json'), clock });
  const sessions = createActorSessions(clock);
  const pinStore = createPinStore({ path: join(dir, 'pins.json'), clock });
  await pinStore.set(PARENT_PIN_ID, '2468');
  const access = createAccess({ config, devices, screens, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const hub = createScreenHub({ clock, waitMs: 30, reportMs: 2_000 });
  const film = createScreenFilm({ hub, clock });
  hub.useDiscreet(film.discreet);
  const household = createHousehold(config);
  const plays: { target: CastTarget; media: CastMedia }[] = [];
  const voice = createVoiceMessages({ rules: () => config.current().cast, clock, play: async (target, media) => void plays.push({ target, media }), logger: { log: () => {} } });
  const fallback = createScreenFallback({ hub, cast: () => config.current().cast, store: createScreenFallbackStore({ path: join(dir, 'fallbacks.json') }), film: film.on });
  const api = createRouter();
  const apps = createScreenAppStore({ path: join(dir, 'screen-apps.json'), clock });
  api.route('/', createScreenApi({ screens, apps, hub, voice, config, household, access, fallback, film }));
  api.route('/', createScreenMediaApi({ screens, hub, household, access, pins: createPinGate(pinStore), film }));
  const alerts = createScreenAlertStore();
  api.route('/', createScreenAlertsApi({ alerts, timers: createTimerStore({ clock }), access, clock, onChange: (a) => film.setAuto(a.film) }));

  type Options = { from?: string; token?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> };
  const call = (method: string, path: string, { from = OTHER, token, body, raw, headers }: Options = {}) =>
    api.request(
      path,
      {
        method,
        headers: { ...(raw === undefined && { 'Content-Type': 'application/json' }), ...headers, ...(token && { Authorization: `Bearer ${token}` }) },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      },
      connectedFrom(from),
    );
  const tablet = (who: string | null = 'alex') => ({ from: TABLET, headers: who ? { 'X-Actor-Session': sessions.open(who, 10).token } : ({} as Record<string, string>) });
  const phone = async (id: string) => (await devices.claim(devices.createCode(id).code, `Téléphone de ${id}`))!.token;
  const alex = await phone('alex');
  const lea = await phone('lea');

  const start = (await (await call('POST', '/screen/pairing', { from: TV, headers: PROTOCOL, body: {} })).json()) as ScreenPairingStart;
  const waiting = call('GET', `/screen/pairing/${start.id}`, { from: TV, headers: PROTOCOL });
  await call('POST', '/screens', { ...tablet(), body: { code: start.code, name: 'Télé du salon' } });
  const paired = (await (await waiting).json()) as ScreenPairingState;
  if (paired.status !== 'paired') throw new Error('télé non appairée');
  const tv = { token: paired.token, id: paired.screen.id };
  const tvCall = (method: string, path: string, body?: unknown) => call(method, path, { from: TV, token: tv.token, headers: PROTOCOL, body });
  /** La télé se signale et annonce son écran et son appli au premier plan. */
  const tvState = async (foreground: string | null, screenOn = true) => {
    await tvCall('GET', '/screen/events');
    await tvCall('POST', '/screen/state', { screenOn, foreground, control: 'adb', addresses: [] });
  };
  const remoteFilm = async () => ((await (await call('GET', '/screens/remote', { token: alex })).json()) as RemoteScreen[])[0]!.film;
  const tabletFilm = async () => ((await (await call('GET', '/screens/media', tablet(null))).json()) as MediaScreens).screens[0]!.film;
  const setFilm = (on: boolean, opts: Options) => call('PUT', `/screens/${tv.id}/film`, { ...opts, body: { on, ...(opts.body as object) } });
  const sendVoice = () => call('POST', `/screens/${tv.id}/voice`, { token: alex, raw: new Uint8Array([1, 2, 3, 4]), headers: { 'Content-Type': 'audio/webm' } });
  return { call, tablet, alex, lea, tv, tvState, remoteFilm, tabletFilm, setFilm, sendVoice, plays };
}

describe('API du mode film', () => {
  it('allumé tout seul par Netflix, vu du téléphone et de la tablette ; coupé par le réglage du panneau Télés', async () => {
    const { call, tablet, tvState, remoteFilm, tabletFilm } = await setup();
    await tvState('fr.exemple.video');
    expect(await remoteFilm()).toEqual({ on: false, why: null, until: null } satisfies ScreenFilm);
    await tvState(NETFLIX);
    expect(await remoteFilm()).toEqual({ on: true, why: 'auto', until: null });
    expect(await tabletFilm()).toEqual({ on: true, why: 'auto', until: null });
    await call('PUT', '/screens/alerts', { ...tablet(), body: { timer: true, film: false } });
    expect((await remoteFilm())?.on).toBe(false);
  });

  it('à la main : un parent depuis son téléphone, ou la tablette avec un parent reconnu ou le code parent', async () => {
    const { tablet, alex, tvState, setFilm, remoteFilm } = await setup();
    await tvState('fr.exemple.box');
    expect(await (await setFilm(true, { token: alex })).json()).toMatchObject({ on: true, why: 'manual' });
    expect(await (await setFilm(false, tablet())).json()).toMatchObject({ on: false, why: 'manual' });
    expect(await (await setFilm(true, { ...tablet(null), body: { pin: '2468' } })).json()).toMatchObject({ on: true, why: 'manual' });
    expect((await remoteFilm())?.on).toBe(true);
  });

  it('enfant, personne, mauvais code : refusés ; télé en veille : 409, injoignable : 503', async () => {
    const { tablet, lea, tvState, setFilm } = await setup();
    expect(await (await setFilm(true, { token: lea })).json()).toEqual({ error: REMOTE_PARENTS_ONLY });
    expect((await setFilm(true, tablet('lea'))).status).toBe(403);
    expect((await setFilm(true, tablet(null))).status).toBe(403);
    expect((await setFilm(true, { ...tablet(null), body: { pin: '0000' } })).status).toBe(403);
    expect(await (await setFilm(true, tablet())).json()).toEqual({ error: SCREEN_OFFLINE });
    await tvState(null, false);
    expect(await (await setFilm(true, tablet())).json()).toEqual({ error: FILM_SCREEN_STANDBY });
  });

  it('message vocal pendant un film : lu sur le Google Home, sans rien envoyer à la télé, et le téléphone le dit', async () => {
    const { tvState, sendVoice, plays } = await setup();
    await tvState(NETFLIX);
    expect(await (await sendVoice()).json()).toEqual({ device: 'Google Home du salon', fallback: { reason: 'film', notice: 'Mode film : lu sur Google Home du salon.' } });
    expect(plays).toHaveLength(1);
  });
});
