// Tests de la vidéo YouTube envoyée à la tablette : envoi par un téléphone appairé (enfant compris), attente de la
// tablette (rien de rejoué au démarrage, la nouvelle vidéo remplace l'ancienne), validation stricte (identifiant de
// 11 caractères, instant de départ, aucune adresse), droits (ni la tablette ni un inconnu n'envoient ; seule la
// tablette reçoit), tablette absente.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TabletVideoReply } from '../shared/video.ts';
import { createAccess, kioskKeyMatcher, VIDEO_PHONE_ONLY } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createTabletVideo, VIDEO_TABLET_OFFLINE, VIDEO_TTL_MS } from './services/tablet-video.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { connectedFrom, NOW } from './testing.ts';
import { createVideoApi } from './video-api.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const ID = 'dQw4w9WgXcQ';

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
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-video-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const channel = createTabletVideo({ clock, waitMs: 40, goneMs: 5_000 });
  const api = createRouter();
  api.route('/', createVideoApi({ channel, household: createHousehold(config), access }));

  const phone = async (ownerId: string) => {
    const { code } = devices.createCode(ownerId);
    return (await devices.claim(code, `Téléphone de ${ownerId}`))!.token;
  };
  type Options = { from?: string; token?: string; body?: unknown };
  const call = (method: string, path: string, { from = OTHER, token, body }: Options = {}) =>
    api.request(
      path,
      {
        method,
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      connectedFrom(from),
    );
  const next = async (after: number | null) => {
    const res = await call('GET', `/video/tablet/next${after === null ? '' : `?after=${after}`}`, { from: TABLET });
    expect(res.status).toBe(200);
    return (await res.json()) as TabletVideoReply;
  };
  const send = (token: string, body: unknown) => call('POST', '/video/tablet', { token, body });
  return { phone, call, next, send, advance: (ms: number) => (now += ms) };
}

describe('vidéo vers la tablette', () => {
  it('un téléphone envoie, la tablette reçoit (sans rejouer au démarrage)', async () => {
    const { phone, next, send } = await setup();
    const lea = await phone('lea');
    const first = await next(null); // la page démarre : la tablette écoute
    expect(first).toEqual({ video: null, last: 0 });
    const waiting = next(first.last);
    const res = await send(lea, { videoId: ID, start: 90 });
    expect(res.status).toBe(202);
    expect(await waiting).toEqual({ video: { videoId: ID, start: 90, from: 'Léa', seq: 1 }, last: 1 });
    // Page rechargée : la vidéo déjà envoyée ne repart pas.
    expect(await next(null)).toEqual({ video: null, last: 1 });
    expect(await next(1)).toEqual({ video: null, last: 1 });
  });

  it('la dernière vidéo remplace la précédente', async () => {
    const { phone, next, send } = await setup();
    const alex = await phone('alex');
    await next(null);
    await send(alex, { videoId: ID });
    await send(alex, { videoId: 'abcdefghij_', start: 0 });
    expect((await next(0)).video).toMatchObject({ videoId: 'abcdefghij_', start: 0, from: 'Alex', seq: 2 });
  });

  it('une vidéo trop ancienne n’est plus lancée', async () => {
    const { phone, next, send, advance } = await setup();
    const alex = await phone('alex');
    await next(null);
    await send(alex, { videoId: ID });
    advance(VIDEO_TTL_MS);
    expect((await next(0)).video).toBeNull();
  });

  it('refuse l’envoi quand aucune tablette n’écoute', async () => {
    const { phone, next, send, advance } = await setup();
    const alex = await phone('alex');
    expect(await (await send(alex, { videoId: ID })).json()).toEqual({ error: VIDEO_TABLET_OFFLINE });
    await next(null);
    expect((await send(alex, { videoId: ID })).status).toBe(202);
    advance(6_000);
    expect((await send(alex, { videoId: ID })).status).toBe(503);
  });

  it.each([
    [{ videoId: 'court' }],
    [{ videoId: `${ID}x` }],
    [{ videoId: 'dQw4w9WgXc/' }],
    [{ videoId: ID, start: -1 }],
    [{ videoId: ID, start: 1.5 }],
    [{ videoId: ID, start: 100_000 }],
    [{ videoId: ID, url: 'https://example.org/' }],
    [{ url: `https://youtu.be/${ID}` }],
  ])('refuse %j', async (body) => {
    const { phone, next, send } = await setup();
    await next(null);
    expect((await send(await phone('alex'), body)).status).toBe(400);
  });

  it('droits : seul un téléphone appairé envoie, seule la tablette reçoit', async () => {
    const { phone, call, next } = await setup();
    await next(null);
    const tablet = await call('POST', '/video/tablet', { from: TABLET, body: { videoId: ID } });
    expect(tablet.status).toBe(403);
    expect(await tablet.json()).toEqual({ error: VIDEO_PHONE_ONLY });
    expect((await call('POST', '/video/tablet', { body: { videoId: ID } })).status).toBe(403);
    expect((await call('POST', '/video/tablet', { token: 'jeton-inconnu', body: { videoId: ID } })).status).toBe(401);
    // Un téléphone (ou un autre appareil) n'écoute pas les vidéos de la tablette.
    expect((await call('GET', '/video/tablet/next', { token: await phone('alex') })).status).toBe(403);
    expect((await call('GET', '/video/tablet/next')).status).toBe(403);
    expect((await call('GET', '/video/tablet/next?after=-3', { from: TABLET })).status).toBe(400);
  });
});
