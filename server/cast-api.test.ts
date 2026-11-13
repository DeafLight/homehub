// Tests des messages vocaux vers les appareils Cast : réservés au téléphone d'un parent (ni enfant, ni tablette, ni
// appareil non appairé), refusés si `camera.talk` est coupé ; le message part vers le faux appareil, qui le télécharge
// à une adresse aléatoire servie sans authentification, puis expirée ; appareil inconnu, injoignable, format refusé.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { createCastApi, createMediaApp, VOICE_OFF, VOICE_PARENTS_ONLY, VOICE_PHONE_ONLY } from './cast-api.ts';
import { parseConfig, toPublicConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { type FakeCastDevice, startFakeCastDevice } from './services/cast-fake.ts';
import { createVoiceMessages, VOICE_TTL_MS, voiceType } from './services/voice-messages.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

let device: FakeCastDevice | null = null;
afterEach(async () => {
  await device?.close();
  device = null;
});

async function setup({ camera = {}, mediaUrl = 'http://192.168.1.10:3010/', refuse = false }: { camera?: unknown; mediaUrl?: string | null; refuse?: boolean } = {}) {
  device = await startFakeCastDevice({ refuse });
  let now = NOW.getTime();
  const clock = () => new Date(now);
  const raw = {
    members: [
      { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
      { id: 'lea', name: 'Léa', color: '#3fb8a8' },
    ],
    kiosk: { addresses: [TABLET] },
    camera,
    cast: {
      ...(mediaUrl && { mediaUrl }),
      devices: [
        { id: 'salon', name: 'Google Home du salon', host: '127.0.0.1', port: device.port },
        { id: 'tele', name: 'Télé', host: '127.0.0.1', port: 1, kind: 'tv' },
      ],
    },
  };
  const config = createConfigStore(parseConfig(raw));
  const dir = mkdtempSync(join(tmpdir(), 'homehub-cast-api-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const steps: string[] = [];
  const voice = createVoiceMessages({ rules: () => config.current().cast, clock, logger: { log: (line: string) => void steps.push(line) } });
  const api = createRouter();
  api.route('/', createCastApi({ voice, config, household: createHousehold(config), access }));

  const phone = async (ownerId: string) => {
    const { code } = devices.createCode(ownerId);
    return (await devices.claim(code, `Téléphone de ${ownerId}`))!.token;
  };
  const send = (target: string, { token, from = OTHER, type = 'audio/webm;codecs=opus', body = AUDIO, headers = {} }: { token?: string; from?: string; type?: string; body?: Uint8Array<ArrayBuffer>; headers?: Record<string, string> } = {}) =>
    api.request(`/cast/${target}/voice`, { method: 'POST', headers: { 'Content-Type': type, ...headers, ...(token && { Authorization: `Bearer ${token}` }) }, body }, connectedFrom(from));
  const get = (path: string) => api.request(path, {}, connectedFrom(OTHER));
  return { send, get, voice, steps, sessions, config, alex: await phone('alex'), lea: await phone('lea'), advance: (ms: number) => (now += ms) };
}

describe('messages vocaux : droits', () => {
  it('un enfant, un appareil non appairé, la tablette : refusés', async () => {
    const { send, lea, sessions } = await setup();
    expect(await (await send('salon', { token: lea })).json()).toEqual({ error: VOICE_PARENTS_ONLY });
    expect((await send('salon')).status).toBe(403);
    const { token } = sessions.open('alex', 10);
    const fromTablet = await send('salon', { from: TABLET, headers: { 'X-Actor-Session': token } });
    expect(await fromTablet.json()).toEqual({ error: VOICE_PHONE_ONLY });
    expect(device!.plays).toEqual([]);
  });

  it('camera.talk coupé : refusé, et aucun appareil proposé au front', async () => {
    const { send, alex, config } = await setup({ camera: { talk: false } });
    expect(await (await send('salon', { token: alex })).json()).toEqual({ error: VOICE_OFF });
    expect(toPublicConfig(config.current(), 'r').cast).toEqual([]);
  });
});

describe('messages vocaux : envoi', () => {
  it('le parent envoie, l’appareil lit l’adresse aléatoire, qui sert le message puis expire', async () => {
    const { send, get, alex, advance, steps } = await setup();
    const res = await send('salon', { token: alex });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ device: 'Google Home du salon' });
    // Journal du conteneur : les étapes, sans le contenu ni l'expéditeur.
    expect(steps[0]).toBe('Cast salon : message de 8 octets (audio/webm)');
    expect(steps.some((line) => line.startsWith('Cast salon : média : PLAYING'))).toBe(true);
    expect(steps.join(' | ')).not.toContain('Alex');
    const [play] = device!.plays;
    expect(play).toMatchObject({ contentType: 'audio/webm', title: 'Message de Alex' });
    expect(play!.url).toMatch(/^http:\/\/192\.168\.1\.10:3010\/api\/cast\/clips\/[A-Za-z0-9_-]{32}\.webm$/);

    const path = new URL(play!.url).pathname.replace('/api', '');
    const clip = await get(path);
    expect(clip.headers.get('content-type')).toBe('audio/webm');
    expect(new Uint8Array(await clip.arrayBuffer())).toEqual(AUDIO);
    expect((await get('/cast/clips/inconnu.webm')).status).toBe(404);
    advance(VOICE_TTL_MS + 1);
    expect((await get(path)).status).toBe(404);
  });

  it('appareil inconnu, injoignable, format refusé, message vide, adresse du NAS absente', async () => {
    const { send, alex } = await setup();
    expect((await send('cuisine', { token: alex })).status).toBe(404);
    const unreachable = await send('tele', { token: alex });
    expect(unreachable.status).toBe(502);
    expect((await unreachable.json()).error).toBe('Télé : appareil injoignable');
    expect((await send('salon', { token: alex, type: 'video/mp4' })).status).toBe(400);
    expect((await send('salon', { token: alex, body: new Uint8Array() })).status).toBe(400);
    await device!.close();
    const bare = await setup({ mediaUrl: null });
    expect((await bare.send('salon', { token: bare.alex })).status).toBe(503);
  });

  it('format que l’appareil ne lit pas : message clair', async () => {
    const { send, alex } = await setup({ refuse: true });
    const res = await send('salon', { token: alex, type: 'audio/mp4' });
    expect(res.status).toBe(502);
    // Le faux appareil refuse sans télécharger : HomeHub le signale (adresse cast.mediaUrl à vérifier).
    expect((await res.json()).error).toBe('Google Home du salon : l’appareil ne sait pas lire ce message, message jamais téléchargé (cast.mediaUrl joignable ?)');
  });

  it('type d’enregistrement : base du type, paramètres ignorés', () => {
    expect(voiceType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(voiceType('Audio/MP4')).toBe('audio/mp4');
    expect(voiceType('text/plain')).toBeNull();
    expect(voiceType(undefined)).toBeNull();
  });
});

describe('configuration cast', () => {
  it('appareils proposés au front sans leur adresse ; identifiants en double refusés', async () => {
    const { config } = await setup();
    expect(toPublicConfig(config.current(), 'r').cast).toEqual([
      { id: 'salon', name: 'Google Home du salon', kind: 'speaker' },
      { id: 'tele', name: 'Télé', kind: 'tv' },
    ]);
    const dup = { id: 'a', name: 'A', host: 'h' };
    expect(() => parseConfig({ members: [{ id: 'alex', name: 'Alex', color: '#5b8def' }], cast: { devices: [dup, dup] } })).toThrow('double');
  });
});

describe('port des médias', () => {
  it('sert les messages, et rien d’autre', async () => {
    const { send, voice, alex } = await setup();
    await send('salon', { token: alex });
    const media = createMediaApp(voice);
    const path = new URL(device!.plays[0]!.url).pathname;
    expect(new Uint8Array(await (await media.request(path)).arrayBuffer())).toEqual(AUDIO);
    expect((await media.request('/api/health')).status).toBe(404);
    expect((await media.request('/api/cast/salon/voice', { method: 'POST', body: AUDIO })).status).toBe(404);
    expect((await media.request('/')).status).toBe(404);
  });
});
