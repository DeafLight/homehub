// Tests des routes de l'appli HomeHub TV : appairage par code tapé sur la tablette (parent reconnu seulement), version
// du protocole, événements par interrogation longue, message vocal du téléphone d'un parent lu par la télé (compte
// rendu, échec, télé absente), droits (enfant, tablette, appareil non appairé, jeton de téléphone), télé retirée ;
// télécommande : état (allumée, en veille, injoignable), liste des applis, touches, texte, lancement, « À table ! »,
// marche/arrêt et allumage par Cast, parents seulement.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_PROTOCOL_HEADER, type RemoteApps, type RemoteScreen, type Screen, type ScreenEvents, type ScreenPairingStart, type ScreenPairingState } from '../shared/screen.ts';
import { createAccess, kioskKeyMatcher, REMOTE_PARENTS_ONLY, UNKNOWN_SCREEN } from './access.ts';
import { VOICE_OFF, VOICE_PARENTS_ONLY, VOICE_PHONE_ONLY } from './cast-api.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { NO_CAST_TO_WAKE, OUTDATED_APP, SCREENS_PARENTS_ONLY, UNKNOWN_APP, createScreenApi } from './screen-api.ts';
import type { CastTarget } from './services/cast.ts';
import { createScreenHub, SCREEN_OFFLINE, SCREEN_SILENT } from './services/screens.ts';
import { createVoiceMessages } from './services/voice-messages.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createScreenAppStore } from './sources/screen-apps.ts';
import { createActorSessions } from './sources/faces.ts';
import { createScreenStore } from './sources/screens.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const TV = '192.168.1.60';
const PROTOCOL = { [SCREEN_PROTOCOL_HEADER]: '1' };

async function setup({ talk = true, reportMs = 2_000, castDevices = [] as { id: string; name: string; host: string; kind?: 'tv' | 'speaker' }[] } = {}) {
  let now = NOW.getTime();
  const clock = () => new Date(now);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
      camera: { talk },
      cast: { devices: castDevices },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-screen-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const screens = createScreenStore({ path: join(dir, 'screens.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, screens, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const hub = createScreenHub({ clock, waitMs: 30, reportMs });
  const voice = createVoiceMessages({ rules: () => config.current().cast, clock });
  const api = createRouter();
  const apps = createScreenAppStore({ path: join(dir, 'screen-apps.json'), clock });
  const wakes: CastTarget[] = [];
  api.route('/', createScreenApi({ screens, apps, hub, voice, config, household: createHousehold(config), access, wake: async (target) => void wakes.push(target) }));

  const phone = async (ownerId: string) => {
    const { code } = devices.createCode(ownerId);
    return (await devices.claim(code, `Téléphone de ${ownerId}`))!.token;
  };
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
  /** La tablette, avec un parent (ou un enfant) reconnu devant elle. */
  const tablet = (who: string | null = 'alex'): { from: string; headers: Record<string, string> } => ({
    from: TABLET,
    headers: who ? { 'X-Actor-Session': sessions.open(who, 10).token } : {},
  });

  /** Appaire une télé : elle demande un code, Alex le tape sur la tablette ; renvoie son jeton. */
  async function pairTv(name = 'Télé du salon') {
    const start = (await (await call('POST', '/screen/pairing', { from: TV, headers: PROTOCOL, body: { system: 'Android 10', app: '0.69.0' } })).json()) as ScreenPairingStart;
    const waiting = call('GET', `/screen/pairing/${start.id}`, { from: TV, headers: PROTOCOL });
    const paired = await call('POST', '/screens', { ...tablet(), body: { code: start.code.toLowerCase(), name } });
    expect(paired.status).toBe(201);
    const state = (await (await waiting).json()) as ScreenPairingState;
    if (state.status !== 'paired') throw new Error('télé non appairée');
    return { token: state.token, id: state.screen.id };
  }
  const listen = (token: string, after = '') => call('GET', `/screen/events?after=${after}`, { from: TV, token, headers: PROTOCOL });
  /** La télé redemande jusqu'à recevoir un événement (l'envoi du téléphone peut arriver après une attente vide). */
  async function nextEvents(token: string, after: string) {
    for (let i = 0; i < 100; i++) {
      const found = (await (await listen(token, after)).json()) as ScreenEvents;
      if (found.events.length) return found;
    }
    throw new Error('aucun événement reçu');
  }

  return { call, tablet, pairTv, listen, nextEvents, wakes, alex: await phone('alex'), lea: await phone('lea'), advance: (ms: number) => (now += ms) };
}

const audio = (type = 'audio/webm') => ({ raw: new Uint8Array([1, 2, 3, 4]), headers: { 'Content-Type': type } });

describe('API HomeHub TV : appairage', () => {
  it('code affiché sur la télé, tapé sur la tablette par un parent ; jeton remis une fois', async () => {
    const { call, tablet, pairTv } = await setup();
    const { id } = await pairTv();
    const list = (await (await call('GET', '/screens', tablet(null))).json()) as Screen[];
    expect(list).toEqual([expect.objectContaining({ id, name: 'Télé du salon', system: 'Android 10', app: '0.69.0', online: false })]);
  });

  it('un enfant reconnu, personne, un téléphone : ne peuvent pas appairer', async () => {
    const { call, tablet, alex } = await setup();
    const start = (await (await call('POST', '/screen/pairing', { from: TV, headers: PROTOCOL, body: {} })).json()) as ScreenPairingStart;
    expect(await (await call('POST', '/screens', { ...tablet('lea'), body: { code: start.code, name: 'Télé' } })).json()).toEqual({ error: SCREENS_PARENTS_ONLY });
    expect((await call('POST', '/screens', { ...tablet(null), body: { code: start.code, name: 'Télé' } })).status).toBe(403);
    expect((await call('POST', '/screens', { token: alex, body: { code: start.code, name: 'Télé' } })).status).toBe(403);
    expect((await call('POST', '/screens', { ...tablet(), body: { code: 'ZZZZZZ', name: 'Télé' } })).status).toBe(410);
  });

  it('appli sans la bonne version du protocole : 426', async () => {
    const { call } = await setup();
    expect(await (await call('POST', '/screen/pairing', { from: TV, body: {} })).json()).toEqual({ error: OUTDATED_APP });
    expect((await call('POST', '/screen/pairing', { from: TV, headers: { [SCREEN_PROTOCOL_HEADER]: '99' }, body: {} })).status).toBe(426);
  });

  it('demande inconnue : 410', async () => {
    const { call } = await setup();
    expect((await call('GET', '/screen/pairing/inconnue', { from: TV, headers: PROTOCOL })).status).toBe(410);
  });
});

describe('API HomeHub TV : droits de la télé', () => {
  it('un jeton de téléphone n’est pas une télé ; une télé ne passe pas pour un téléphone', async () => {
    const { call, pairTv, listen, alex } = await setup();
    expect(await (await listen(alex)).json()).toEqual({ error: UNKNOWN_SCREEN });
    const tv = await pairTv();
    expect((await call('GET', '/screens/targets', { token: tv.token })).status).toBe(401);
    expect((await call('POST', `/screens/${tv.id}/voice`, { token: tv.token, ...audio() })).status).toBe(401);
  });

  it('télé retirée depuis la tablette : 401 à sa demande suivante', async () => {
    const { call, tablet, pairTv, listen } = await setup();
    const tv = await pairTv();
    expect((await listen(tv.token)).status).toBe(200);
    expect((await call('DELETE', `/screens/${tv.id}`, tablet('lea'))).status).toBe(403);
    expect((await call('DELETE', `/screens/${tv.id}`, tablet())).status).toBe(204);
    expect((await listen(tv.token)).status).toBe(401);
  });

  it('renommée par un parent sur la tablette', async () => {
    const { call, tablet, pairTv } = await setup();
    const tv = await pairTv();
    expect(((await (await call('PATCH', `/screens/${tv.id}`, { ...tablet(), body: { name: 'Salon' } })).json()) as Screen).name).toBe('Salon');
  });
});

describe('API HomeHub TV : message vocal', () => {
  it('le téléphone d’un parent envoie, la télé télécharge, lit et rend compte', async () => {
    const { call, pairTv, listen, nextEvents, alex } = await setup();
    const tv = await pairTv();
    await listen(tv.token);
    expect(await (await call('GET', '/screens/targets', { token: alex })).json()).toEqual([{ id: tv.id, name: 'Télé du salon', online: true }]);

    const sending = call('POST', `/screens/${tv.id}/voice`, { token: alex, ...audio('audio/webm;codecs=opus') });
    const { events } = await nextEvents(tv.token, '0');
    expect(events).toEqual([expect.objectContaining({ seq: 1, kind: 'voice', title: 'Message d’Alex', contentType: 'audio/webm' })]);
    const event = events[0]!;
    if (event.kind !== 'voice') throw new Error('message vocal attendu');
    expect(event.audio).toMatch(/^\/api\/screen\/clips\/[\w-]+\.webm$/);

    const clipPath = event.audio.replace(/^\/api/, '');
    expect((await call('GET', clipPath)).status).toBe(401);
    const clip = await call('GET', clipPath, { from: TV, token: tv.token });
    expect(new Uint8Array(await clip.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

    expect((await call('POST', `/screen/events/${event.id}/report`, { from: TV, token: tv.token, headers: PROTOCOL, body: { ok: true } })).status).toBe(204);
    expect(await (await sending).json()).toEqual({ device: 'Télé du salon' });
  });

  it('échec rapporté par la télé, ou pas de nouvelles : 502 avec la raison', async () => {
    const { call, pairTv, listen, nextEvents, alex } = await setup({ reportMs: 50 });
    const tv = await pairTv();
    await listen(tv.token);
    const sending = call('POST', `/screens/${tv.id}/voice`, { token: alex, ...audio() });
    const { events } = await nextEvents(tv.token, '0');
    await call('POST', `/screen/events/${events[0]!.id}/report`, { from: TV, token: tv.token, headers: PROTOCOL, body: { ok: false, reason: 'Format illisible' } });
    expect(await (await sending).json()).toEqual({ error: 'Télé du salon : Format illisible' });

    await listen(tv.token, '1');
    const silent = await call('POST', `/screens/${tv.id}/voice`, { token: alex, ...audio() });
    expect(await silent.json()).toEqual({ error: `Télé du salon : ${SCREEN_SILENT}` });
  });

  it('télé absente (plus de nouvelles depuis 40 s) : 503', async () => {
    const { call, pairTv, listen, alex, advance } = await setup();
    const tv = await pairTv();
    expect(await (await call('POST', `/screens/${tv.id}/voice`, { token: alex, ...audio() })).json()).toEqual({ error: SCREEN_OFFLINE });
    await listen(tv.token);
    advance(41_000);
    expect((await call('POST', `/screens/${tv.id}/voice`, { token: alex, ...audio() })).status).toBe(503);
  });

  it('un enfant, la tablette, parler désactivé, un format refusé : refusés', async () => {
    const { call, tablet, pairTv, listen, alex, lea } = await setup();
    const tv = await pairTv();
    await listen(tv.token);
    expect(await (await call('POST', `/screens/${tv.id}/voice`, { token: lea, ...audio() })).json()).toEqual({ error: VOICE_PARENTS_ONLY });
    const fromTablet = tablet();
    expect(await (await call('POST', `/screens/${tv.id}/voice`, { ...fromTablet, ...audio(), headers: { ...fromTablet.headers, 'Content-Type': 'audio/webm' } })).json()).toEqual({ error: VOICE_PHONE_ONLY });
    expect((await call('POST', `/screens/${tv.id}/voice`, { token: alex, ...audio('video/mp4') })).status).toBe(400);
    expect((await call('POST', '/screens/inconnue/voice', { token: alex, ...audio() })).status).toBe(404);

    const off = await setup({ talk: false });
    expect(await (await off.call('GET', '/screens/targets', { token: off.alex })).json()).toEqual({ error: VOICE_OFF });
  });
});

describe('API HomeHub TV : télécommande', () => {
  const state = (screenOn: boolean) => ({ screenOn, foreground: 'fr.exemple.video', control: 'adb', addresses: ['192.168.1.60'] });
  const banner = 'iVBORw0KGgo=';

  /** La télé écoute ses événements et répond à chacun (ok, ou l'échec donné) ; renvoie ce qu'elle a reçu. */
  function answer(env: Awaited<ReturnType<typeof setup>>, token: string, reply: { ok: boolean; reason?: string } = { ok: true }) {
    const got: ScreenEvents['events'] = [];
    let after = '';
    let stop = false;
    void (async () => {
      while (!stop) {
        const { events, last } = (await (await env.listen(token, after)).json()) as ScreenEvents;
        after = String(last);
        for (const e of events) {
          got.push(e);
          await env.call('POST', `/screen/events/${e.id}/report`, { from: TV, token, headers: PROTOCOL, body: reply });
        }
      }
    })();
    return { got, stop: () => (stop = true) };
  }

  it('état, applis et appli au premier plan, envoyés par la télé, vus par un parent', async () => {
    const env = await setup();
    const tv = await env.pairTv();
    expect(await (await env.call('GET', '/screens/remote', { token: env.alex })).json()).toEqual([
      { id: tv.id, name: 'Télé du salon', power: 'offline', control: null, foreground: null, canWake: false, appsAt: null, appCount: 0 },
    ]);
    await env.listen(tv.token);
    expect((await env.call('POST', '/screen/state', { from: TV, token: tv.token, headers: PROTOCOL, body: state(false) })).status).toBe(204);
    const list = { apps: [{ package: 'fr.exemple.video', name: 'Vidéo', banner }, { package: 'fr.exemple.box', name: 'Box', banner: null }] };
    expect((await env.call('PUT', '/screen/apps', { from: TV, token: tv.token, headers: PROTOCOL, body: list })).status).toBe(204);
    const [remote] = (await (await env.call('GET', '/screens/remote', { token: env.alex })).json()) as RemoteScreen[];
    expect(remote).toMatchObject({ power: 'standby', control: 'adb', foreground: { package: 'fr.exemple.video', name: 'Vidéo' }, appCount: 2 });
    const apps = (await (await env.call('GET', `/screens/${tv.id}/apps`, { token: env.alex })).json()) as RemoteApps;
    expect(apps.apps).toEqual([
      { package: 'fr.exemple.box', name: 'Box', banner: null },
      { package: 'fr.exemple.video', name: 'Vidéo', banner: `data:image/png;base64,${banner}` },
    ]);
    // État mal formé, ou envoyé par un téléphone : refusé.
    expect((await env.call('POST', '/screen/state', { from: TV, token: tv.token, headers: PROTOCOL, body: { screenOn: 'oui' } })).status).toBe(400);
    expect((await env.call('POST', '/screen/state', { token: env.alex, headers: PROTOCOL, body: state(true) })).status).toBe(401);
  });

  it('touches regroupées, texte, lancement et « À table ! » : la télé les reçoit et rend compte', async () => {
    const env = await setup();
    const tv = await env.pairTv();
    await env.listen(tv.token);
    await env.call('PUT', '/screen/apps', { from: TV, token: tv.token, headers: PROTOCOL, body: { apps: [{ package: 'fr.exemple.video', name: 'Vidéo', banner: null }] } });
    const telly = answer(env, tv.token);
    expect(await (await env.call('POST', `/screens/${tv.id}/keys`, { token: env.alex, body: { keys: ['down', 'down', 'ok'] } })).json()).toEqual({ ok: true });
    expect((await env.call('POST', `/screens/${tv.id}/text`, { token: env.alex, body: { text: 'dessin animé', submit: true } })).status).toBe(200);
    expect((await env.call('POST', `/screens/${tv.id}/launch`, { token: env.alex, body: { package: 'fr.exemple.video' } })).status).toBe(200);
    expect(await (await env.call('POST', `/screens/${tv.id}/launch`, { token: env.alex, body: { package: 'fr.exemple.autre' } })).json()).toEqual({ error: UNKNOWN_APP });
    expect((await env.call('POST', `/screens/${tv.id}/dinner`, { token: env.alex })).status).toBe(200);
    telly.stop();
    expect(telly.got.map(({ seq: _s, id: _i, ...e }) => e)).toEqual([
      { kind: 'key', keys: ['down', 'down', 'ok'] },
      { kind: 'text', text: 'dessin animé', submit: true },
      { kind: 'launch', package: 'fr.exemple.video' },
      { kind: 'key', keys: ['pause'], notice: { title: 'À table !', subtitle: 'De la part d’Alex' } },
    ]);
    expect((await env.call('POST', `/screens/${tv.id}/keys`, { token: env.alex, body: { keys: ['saut'] } })).status).toBe(400);
  });

  it('échec rapporté par la télé (adb pas autorisé) : 502 avec la raison', async () => {
    const env = await setup();
    const tv = await env.pairTv();
    await env.listen(tv.token);
    const telly = answer(env, tv.token, { ok: false, reason: 'Touches indisponibles' });
    expect(await (await env.call('POST', `/screens/${tv.id}/keys`, { token: env.alex, body: { keys: ['up'] } })).json()).toEqual({ error: 'Télé du salon : Touches indisponibles' });
    telly.stop();
  });

  it('parents seulement : un enfant, un appareil non appairé, une télé sont refusés', async () => {
    const env = await setup();
    const tv = await env.pairTv();
    expect(await (await env.call('GET', '/screens/remote', { token: env.lea })).json()).toEqual({ error: REMOTE_PARENTS_ONLY });
    expect((await env.call('POST', `/screens/${tv.id}/keys`, { token: env.lea, body: { keys: ['up'] } })).status).toBe(403);
    expect((await env.call('POST', `/screens/${tv.id}/keys`, { body: { keys: ['up'] } })).status).toBe(403);
    expect((await env.call('POST', `/screens/${tv.id}/power`, { token: tv.token, body: { on: true } })).status).toBe(401);
    // Un parent reconnu à la tablette peut s'en servir aussi.
    expect((await env.call('GET', '/screens/remote', env.tablet())).status).toBe(200);
  });

  it('marche/arrêt : veille par l’appli, réveil par l’appli, sinon par l’appareil Cast de la télé', async () => {
    const env = await setup({ castDevices: [{ id: 'enceinte', name: 'Enceinte', host: '192.168.1.70' }, { id: 'salon', name: 'Télé', host: '192.168.1.60', kind: 'tv' }] });
    const tv = await env.pairTv();
    // Injoignable : allumée par Cast (le seul appareil de genre « tv »).
    expect(await (await env.call('POST', `/screens/${tv.id}/power`, { token: env.alex, body: { on: true } })).json()).toEqual({ power: 'offline', via: 'cast' });
    expect(env.wakes).toEqual([{ host: '192.168.1.60', port: 8009 }]);
    expect(await (await env.call('POST', `/screens/${tv.id}/power`, { token: env.alex, body: { on: false } })).json()).toEqual({ error: SCREEN_OFFLINE });

    await env.listen(tv.token);
    await env.call('POST', '/screen/state', { from: TV, token: tv.token, headers: PROTOCOL, body: state(true) });
    const telly = answer(env, tv.token);
    expect(await (await env.call('POST', `/screens/${tv.id}/power`, { token: env.alex, body: { on: true } })).json()).toEqual({ power: 'on', via: null });
    expect(await (await env.call('POST', `/screens/${tv.id}/power`, { token: env.alex, body: { on: false } })).json()).toEqual({ power: 'standby', via: 'screen' });
    await env.call('POST', '/screen/state', { from: TV, token: tv.token, headers: PROTOCOL, body: state(false) });
    expect(await (await env.call('POST', `/screens/${tv.id}/power`, { token: env.alex, body: { on: true } })).json()).toEqual({ power: 'on', via: 'screen' });
    telly.stop();
    expect(telly.got.map((e) => (e.kind === 'power' ? e.on : null))).toEqual([false, true]);
    expect(env.wakes).toHaveLength(1);
  });

  it('appareil Cast retrouvé à l’adresse annoncée par la télé, parmi plusieurs télés', async () => {
    const env = await setup({ castDevices: [{ id: 'chambre', name: 'Chambre', host: '192.168.1.61', kind: 'tv' }, { id: 'salon', name: 'Salon', host: '192.168.1.60', kind: 'tv' }] });
    const tv = await env.pairTv();
    expect(await (await env.call('POST', `/screens/${tv.id}/power`, { token: env.alex, body: { on: true } })).json()).toEqual({ error: NO_CAST_TO_WAKE });
    await env.listen(tv.token);
    await env.call('POST', '/screen/state', { from: TV, token: tv.token, headers: PROTOCOL, body: state(false) });
    env.advance(41_000);
    expect(await (await env.call('POST', `/screens/${tv.id}/power`, { token: env.alex, body: { on: true } })).json()).toEqual({ power: 'offline', via: 'cast' });
    expect(env.wakes).toEqual([{ host: '192.168.1.60', port: 8009 }]);
  });
});
