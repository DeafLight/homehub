// Tests du partage d'une photo ou d'une vidéo vers la télé : dépôt par POST /partager (format, taille), aperçu et
// liste des télés pour le téléphone, envoi à la télé, téléchargement avec son jeton, compte rendu (affichée, échec,
// télé absente), droits (téléphone appairé seulement, enfant compris ; ni la tablette ni un inconnu), expiration.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_MEDIA_MAX_BYTES, type SharedMedia } from '../shared/screen-media.ts';
import { createAccess, kioskKeyMatcher, MEDIA_PHONE_ONLY } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createShareRoute } from './recipes-api.ts';
import { createScreenShareApi, shareMediaHandler } from './screen-share-api.ts';
import { createShareInbox } from './services/recipe-imports.ts';
import { createScreenHub, SCREEN_OFFLINE } from './services/screens.ts';
import { createSharedMedia, MEDIA_EXPIRED, SHARE_INBOX_TTL_MS } from './services/shared-media.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createScreenStore } from './sources/screens.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function setup({ reportMs = 2_000 } = {}) {
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
  const dir = mkdtempSync(join(tmpdir(), 'homehub-screen-media-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const screens = createScreenStore({ path: join(dir, 'screens.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, screens, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const hub = createScreenHub({ clock, waitMs: 30 });
  const store = createSharedMedia({ clock });
  const api = createRouter();
  api.route('/', createScreenShareApi({ screens, hub, store, household: createHousehold(config), access, reportMs }));
  const share = createShareRoute(createShareInbox(), { maxBytes: SCREEN_MEDIA_MAX_BYTES, handle: shareMediaHandler(store) });

  const phone = async (ownerId: string) => {
    const { code } = devices.createCode(ownerId);
    return (await devices.claim(code, `Téléphone de ${ownerId}`))!.token;
  };
  async function pairTv(name = 'Télé du salon') {
    const start = screens.startPairing({ system: null, app: null });
    const waiting = screens.pairing(start.id, 1_000);
    const record = (await screens.confirm(start.code, name))!;
    const state = await waiting;
    if (state?.status !== 'paired') throw new Error('télé non appairée');
    return { id: record.id, token: state.token };
  }
  type Options = { from?: string; token?: string; body?: unknown; headers?: Record<string, string> };
  const call = (method: string, path: string, { from = OTHER, token, body, headers }: Options = {}) =>
    api.request(
      path,
      {
        method,
        headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      connectedFrom(from),
    );
  /** Partage depuis le menu du téléphone : rend l'adresse où la page est renvoyée. */
  async function shareFile(data: Uint8Array, type: string, name = 'IMG_0001.jpg') {
    const form = new FormData();
    form.set('media', new File([data as Uint8Array<ArrayBuffer>], name, { type }));
    const res = await share.request('/partager', { method: 'POST', body: form });
    expect(res.status).toBe(303);
    return new URL(res.headers.get('location')!, 'http://homehub.test');
  }
  /** La télé redemande jusqu'à recevoir un événement. */
  async function nextEvents(token: string) {
    for (let i = 0; i < 100; i++) {
      const { events } = await hub.events((await screens.authenticate(token))!.id, 0);
      if (events.length) return events;
    }
    throw new Error('aucun événement reçu');
  }

  return { call, phone, pairTv, shareFile, nextEvents, hub, alex: await phone('alex'), lea: await phone('lea'), advance: (ms: number) => (now += ms) };
}

describe('Partage vers la télé : dépôt par « Partager »', () => {
  it('une photo est rangée et la page du téléphone reçoit son numéro', async () => {
    const { shareFile, call, alex } = await setup();
    const location = await shareFile(JPEG, 'image/jpeg');
    expect(location.pathname).toBe('/partager');
    const id = location.searchParams.get('media')!;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await (await call('GET', `/screens/shared/${id}`, { token: alex })).json()).toEqual({
      id,
      kind: 'photo',
      type: 'image/jpeg',
      name: 'IMG_0001.jpg',
      bytes: JPEG.byteLength,
    } satisfies SharedMedia);
    const file = await call('GET', `/screens/shared/${id}/file`, { token: alex });
    expect(file.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(JPEG);
  });

  it('une vidéo sans type est reconnue à son extension', async () => {
    const { shareFile, call, lea } = await setup();
    const id = (await shareFile(new Uint8Array([0, 0, 0, 24]), '', 'VID_0001.MP4')).searchParams.get('media')!;
    expect(((await (await call('GET', `/screens/shared/${id}`, { token: lea })).json()) as SharedMedia).kind).toBe('video');
  });

  it('autre chose qu’une photo ou une vidéo : refusé, sans rien garder', async () => {
    const { shareFile } = await setup();
    const location = await shareFile(new Uint8Array([1, 2]), 'application/pdf', 'facture.pdf');
    expect(location.searchParams.get('erreur')).toBe('media-format');
    expect(location.searchParams.has('media')).toBe(false);
  });

  it('fichier trop lourd : refusé', async () => {
    const { shareFile } = await setup();
    const location = await shareFile(new Uint8Array(SCREEN_MEDIA_MAX_BYTES + 1), 'video/mp4', 'long.mp4');
    expect(location.searchParams.get('erreur')).toBe('media-trop-lourd');
  });

  it('le fichier en attente expire', async () => {
    const { shareFile, call, alex, advance } = await setup();
    const id = (await shareFile(JPEG, 'image/jpeg')).searchParams.get('media')!;
    advance(SHARE_INBOX_TTL_MS + 1);
    expect(await (await call('GET', `/screens/shared/${id}`, { token: alex })).json()).toEqual({ error: MEDIA_EXPIRED });
  });
});

describe('Partage vers la télé : envoi', () => {
  it('le téléphone envoie, la télé télécharge avec son jeton, affiche et rend compte', async () => {
    const { shareFile, call, pairTv, nextEvents, hub, lea } = await setup();
    const tv = await pairTv();
    void hub.events(tv.id, null);
    expect(await (await call('GET', '/screens/share-targets', { token: lea })).json()).toEqual([{ id: tv.id, name: 'Télé du salon', online: true }]);

    const shared = (await shareFile(JPEG, 'image/jpeg')).searchParams.get('media')!;
    const sending = call('POST', `/screens/${tv.id}/share`, { token: lea, body: { shared } });
    const [event] = await nextEvents(tv.token);
    if (event?.kind !== 'media') throw new Error('photo attendue');
    expect(event).toEqual(expect.objectContaining({ media: 'photo', title: 'Photo de Léa', contentType: 'image/jpeg', seconds: 60 }));
    expect(event.url).toMatch(/^\/api\/screen\/media\/[\w-]{32}\.jpg$/);

    const path = event.url.replace(/^\/api/, '');
    expect((await call('GET', path)).status).toBe(401);
    expect((await call('GET', path, { token: lea })).status).toBe(401);
    const file = await call('GET', path, { token: tv.token });
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(JPEG);

    hub.report(tv.id, event.id, { ok: true });
    expect(await (await sending).json()).toEqual({ device: 'Télé du salon' });
  });

  it('une vidéo : titre et durée au plus d’une vidéo', async () => {
    const { shareFile, call, pairTv, nextEvents, hub, alex } = await setup();
    const tv = await pairTv();
    void hub.events(tv.id, null);
    const shared = (await shareFile(new Uint8Array([0, 0, 0, 24]), 'video/mp4', 'film.mp4')).searchParams.get('media')!;
    const sending = call('POST', `/screens/${tv.id}/share`, { token: alex, body: { shared } });
    const [event] = await nextEvents(tv.token);
    expect(event).toEqual(expect.objectContaining({ kind: 'media', media: 'video', title: 'Vidéo d’Alex', seconds: 300 }));
    hub.report(tv.id, event!.id, { ok: false, reason: 'vidéo illisible' });
    expect(await (await sending).json()).toEqual({ error: 'Télé du salon : vidéo illisible' });
  });

  it('télé absente : 503 ; télé inconnue : 404 ; fichier expiré : 410', async () => {
    const { shareFile, call, pairTv, alex } = await setup();
    const tv = await pairTv();
    const shared = (await shareFile(JPEG, 'image/jpeg')).searchParams.get('media')!;
    expect(await (await call('POST', `/screens/${tv.id}/share`, { token: alex, body: { shared } })).json()).toEqual({ error: SCREEN_OFFLINE });
    expect((await call('POST', '/screens/inconnue/share', { token: alex, body: { shared } })).status).toBe(404);
    const other = '00000000-0000-4000-8000-000000000000';
    expect((await call('POST', `/screens/${tv.id}/share`, { token: alex, body: { shared: other } })).status).toBe(410);
  });

  it('ni la tablette, ni un appareil non appairé, ni une télé : seulement un téléphone appairé', async () => {
    const { shareFile, call, pairTv } = await setup();
    const tv = await pairTv();
    const shared = (await shareFile(JPEG, 'image/jpeg')).searchParams.get('media')!;
    expect(await (await call('GET', '/screens/share-targets', { from: TABLET })).json()).toEqual({ error: MEDIA_PHONE_ONLY });
    expect((await call('GET', `/screens/shared/${shared}`)).status).toBe(403);
    expect((await call('POST', `/screens/${tv.id}/share`, { token: tv.token, body: { shared } })).status).toBe(401);
  });
});
