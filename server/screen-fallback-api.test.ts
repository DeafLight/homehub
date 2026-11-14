// Tests des routes du secours d'une télé éteinte (fonction 7) : message vocal d'un parent vers la télé, lu sur la
// télé allumée, sur le Google Home quand elle est en veille (état envoyé par l'appli) ou injoignable, ou quand elle
// refuse écran éteint ; cible du téléphone (allumée, secours) ; réglage de l'appareil de secours par la tablette
// (parent reconnu), oublié avec la télé.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_OFF_REASON, SCREEN_PROTOCOL_HEADER, type ScreenEvents, type ScreenFallbackSettings, type ScreenPairingStart, type ScreenPairingState, type ScreenTarget } from '../shared/screen.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { SCREENS_PARENTS_ONLY, UNKNOWN_FALLBACK, createScreenApi } from './screen-api.ts';
import type { CastMedia, CastTarget } from './services/cast.ts';
import { createScreenFallback } from './services/screen-fallback.ts';
import { createScreenHub } from './services/screens.ts';
import { createVoiceMessages } from './services/voice-messages.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createScreenAppStore } from './sources/screen-apps.ts';
import { createScreenFallbackStore } from './sources/screen-fallbacks.ts';
import { createScreenStore } from './sources/screens.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const TV = '192.168.1.60';
const PROTOCOL = { [SCREEN_PROTOCOL_HEADER]: '1' };
const GOOGLE_HOME = { host: '192.168.1.30', port: 8009 };

async function setup() {
  let now = NOW.getTime();
  const clock = () => new Date(now);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
      camera: { talk: true },
      cast: {
        mediaUrl: 'http://192.168.1.10:3010',
        devices: [
          { id: 'salon', name: 'Google Home du salon', ...GOOGLE_HOME },
          { id: 'cuisine', name: 'Google Home de la cuisine', host: '192.168.1.31' },
        ],
      },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-screen-fallback-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const screens = createScreenStore({ path: join(dir, 'screens.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, screens, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const hub = createScreenHub({ clock, waitMs: 30, reportMs: 2_000 });
  const plays: { target: CastTarget; media: CastMedia }[] = [];
  const voice = createVoiceMessages({ rules: () => config.current().cast, clock, play: async (target, media) => void plays.push({ target, media }), logger: { log: () => {} } });
  const store = createScreenFallbackStore({ path: join(dir, 'screen-fallbacks.json') });
  const fallback = createScreenFallback({ hub, cast: () => config.current().cast, store });
  const api = createRouter();
  const apps = createScreenAppStore({ path: join(dir, 'screen-apps.json'), clock });
  api.route('/', createScreenApi({ screens, apps, hub, voice, config, household: createHousehold(config), access, fallback }));

  const { code } = devices.createCode('alex');
  const alex = (await devices.claim(code, 'Téléphone d’Alex'))!.token;
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

  const start = (await (await call('POST', '/screen/pairing', { from: TV, headers: PROTOCOL, body: {} })).json()) as ScreenPairingStart;
  const waiting = call('GET', `/screen/pairing/${start.id}`, { from: TV, headers: PROTOCOL });
  await call('POST', '/screens', { ...tablet(), body: { code: start.code, name: 'Télé du salon' } });
  const paired = (await (await waiting).json()) as ScreenPairingState;
  if (paired.status !== 'paired') throw new Error('télé non appairée');
  const tv = { token: paired.token, id: paired.screen.id };

  const tvCall = (method: string, path: string, body?: unknown) => call(method, path, { from: TV, token: tv.token, headers: PROTOCOL, body });
  /** L'appli annonce son écran (allumé ou éteint). */
  const screenOn = (on: boolean) => tvCall('POST', '/screen/state', { screenOn: on, foreground: null, control: 'adb', addresses: [] });
  /** L'appli attend ses événements jusqu'au premier, et répond `report`. */
  async function answerNext(report: unknown) {
    for (let i = 0; i < 100; i++) {
      const { events } = (await (await tvCall('GET', '/screen/events')).json()) as ScreenEvents;
      if (events[0]) return tvCall('POST', `/screen/events/${events[0].id}/report`, report);
    }
    throw new Error('aucun événement reçu');
  }
  const sendVoice = () => call('POST', `/screens/${tv.id}/voice`, { token: alex, raw: new Uint8Array([1, 2, 3, 4]), headers: { 'Content-Type': 'audio/webm' } });

  return { call, tablet, tv, tvCall, screenOn, answerNext, sendVoice, plays, alex, advance: (ms: number) => (now += ms) };
}

describe('API HomeHub TV : télé éteinte, l’annonce part sur le Google Home', () => {
  it('télé allumée : lue sur la télé, rien sur le Google Home', async () => {
    const { tvCall, answerNext, sendVoice, plays } = await setup();
    await tvCall('GET', '/screen/events');
    const sending = sendVoice();
    await answerNext({ ok: true });
    expect(await (await sending).json()).toEqual({ device: 'Télé du salon', fallback: null });
    expect(plays).toEqual([]);
  });

  it('écran éteint (veille rapide, réseau gardé) : lue sur le Google Home, et le téléphone le dit', async () => {
    const { tvCall, screenOn, sendVoice, plays } = await setup();
    await tvCall('GET', '/screen/events');
    await screenOn(false);
    const res = await sendVoice();
    expect(await res.json()).toEqual({ device: 'Google Home du salon', fallback: { reason: 'standby', notice: 'Télé éteinte : lu sur Google Home du salon.' } });
    expect(plays).toEqual([expect.objectContaining({ target: GOOGLE_HOME, media: expect.objectContaining({ title: 'Message de Alex', contentType: 'audio/webm' }) })]);
  });

  it('télé injoignable : lue sur le Google Home au lieu de 503', async () => {
    const { sendVoice, plays } = await setup();
    expect(await (await sendVoice()).json()).toMatchObject({ device: 'Google Home du salon', fallback: { reason: 'offline' } });
    expect(plays).toHaveLength(1);
  });

  it('la télé refuse, écran éteint entre-temps : rattrapé par le Google Home', async () => {
    const { tvCall, answerNext, sendVoice, plays } = await setup();
    await tvCall('GET', '/screen/events');
    const sending = sendVoice();
    await answerNext({ ok: false, reason: SCREEN_OFF_REASON });
    expect(await (await sending).json()).toMatchObject({ device: 'Google Home du salon', fallback: { reason: 'standby' } });
    expect(plays).toHaveLength(1);
  });

  it('cible du téléphone : allumée ou non, et l’appareil de secours', async () => {
    const { call, alex, tvCall, screenOn, tv } = await setup();
    await tvCall('GET', '/screen/events');
    await screenOn(false);
    expect(await (await call('GET', '/screens/targets', { token: alex })).json()).toEqual([
      { id: tv.id, name: 'Télé du salon', online: true, on: false, fallback: 'Google Home du salon' },
    ] satisfies ScreenTarget[]);
  });
});

describe('API HomeHub TV : réglage de l’appareil de secours', () => {
  it('la tablette lit les réglages ; un parent reconnu choisit, ou n’en veut aucun', async () => {
    const { call, tablet, tv, sendVoice, plays } = await setup();
    const read = async () => (await (await call('GET', '/screens/fallbacks', tablet(null))).json()) as ScreenFallbackSettings;
    expect((await read()).screens).toEqual([{ id: tv.id, device: 'salon', auto: true }]);
    expect((await read()).devices.map((d) => d.id)).toEqual(['salon', 'cuisine']);

    const chosen = await call('PUT', `/screens/${tv.id}/fallback`, { ...tablet(), body: { device: 'cuisine' } });
    expect(((await chosen.json()) as ScreenFallbackSettings).screens).toEqual([{ id: tv.id, device: 'cuisine', auto: false }]);
    await sendVoice();
    expect(plays.map((p) => p.target.host)).toEqual(['192.168.1.31']);

    await call('PUT', `/screens/${tv.id}/fallback`, { ...tablet(), body: { device: null } });
    expect((await read()).screens).toEqual([{ id: tv.id, device: null, auto: false }]);
    expect((await sendVoice()).status).toBe(503);
  });

  it('enfant, personne, téléphone, appareil inconnu : refusés', async () => {
    const { call, tablet, tv, alex } = await setup();
    const body = { device: 'cuisine' };
    expect(await (await call('PUT', `/screens/${tv.id}/fallback`, { ...tablet('lea'), body })).json()).toEqual({ error: SCREENS_PARENTS_ONLY });
    expect((await call('PUT', `/screens/${tv.id}/fallback`, { ...tablet(null), body })).status).toBe(403);
    expect((await call('PUT', `/screens/${tv.id}/fallback`, { token: alex, body })).status).toBe(403);
    expect(await (await call('PUT', `/screens/${tv.id}/fallback`, { ...tablet(), body: { device: 'inconnu' } })).json()).toEqual({ error: UNKNOWN_FALLBACK });
    expect((await call('PUT', '/screens/inconnue/fallback', { ...tablet(), body })).status).toBe(404);
  });

  it('télé retirée : son réglage est oublié', async () => {
    const { call, tablet, tv } = await setup();
    await call('PUT', `/screens/${tv.id}/fallback`, { ...tablet(), body: { device: 'cuisine' } });
    await call('DELETE', `/screens/${tv.id}`, tablet());
    expect(await (await call('GET', '/screens/fallbacks', tablet(null))).json()).toEqual(expect.objectContaining({ screens: [] }));
  });
});
