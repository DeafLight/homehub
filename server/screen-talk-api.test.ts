// Tests de « Parler en direct à la télé » (fonction 9) : ouverture par le téléphone d'un parent (événement `talk` et
// compte rendu de la télé), voix relayée par morceaux numérotés (doublons ignorés, son lu d'un bloc), fin par le
// téléphone, par le silence de l'un ou l'autre ou par la durée, une voix à la fois par télé, droits (enfant,
// tablette, réglage coupé, jeton de télé ou de téléphone à la mauvaise place).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_PROTOCOL_HEADER, type ScreenEvents, type ScreenPairingStart, type ScreenPairingState } from '../shared/screen.ts';
import { TALK_SEQ_HEADER, talkTitle, type ScreenTalkStart } from '../shared/screen-talk.ts';
import { createAccess, kioskKeyMatcher, TALK_OFF, TALK_PARENTS_ONLY, TALK_PHONE_ONLY, UNKNOWN_SCREEN } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createScreenApi } from './screen-api.ts';
import { createScreenTalkApi } from './screen-talk-api.ts';
import { createScreenHub } from './services/screens.ts';
import { createScreenTalk, TALK_IDLE_MS, TALK_PHONE_GONE, TALK_SCREEN_GONE, TALK_STOPPED } from './services/screen-talk.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { createScreenAppStore } from './sources/screen-apps.ts';
import { createScreenStore } from './sources/screens.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const TV = '192.168.1.60';
const PROTOCOL = { [SCREEN_PROTOCOL_HEADER]: '1' };

async function setup({ talk = true, maxMinutes = 10 } = {}) {
  let now = NOW.getTime();
  const clock = () => new Date(now);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'sam', name: 'Sam', color: '#e0a84f', parent: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
      camera: { talk, maxMinutes },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-screen-talk-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const screens = createScreenStore({ path: join(dir, 'screens.json'), clock });
  const sessions = createActorSessions(clock);
  const access = createAccess({ config, devices, screens, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const hub = createScreenHub({ clock, waitMs: 30, reportMs: 2_000 });
  const household = createHousehold(config);
  const talkService = createScreenTalk({ clock, hub, rules: () => config.current().camera, waitMs: 30, reportMs: 300 });
  const api = createRouter();
  api.route('/', createScreenApi({
    screens, apps: createScreenAppStore({ path: join(dir, 'apps.json'), clock }), hub,
    config, household, access,
  }));
  api.route('/', createScreenTalkApi({ screens, talk: talkService, household, access }));

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

  async function pairTv() {
    const start = (await (await call('POST', '/screen/pairing', { from: TV, headers: PROTOCOL, body: {} })).json()) as ScreenPairingStart;
    const waiting = call('GET', `/screen/pairing/${start.id}`, { from: TV, headers: PROTOCOL });
    const parent = { from: TABLET, headers: { 'X-Actor-Session': sessions.open('alex', 10).token } };
    await call('POST', '/screens', { ...parent, body: { code: start.code, name: 'Télé du salon' } });
    const state = (await (await waiting).json()) as ScreenPairingState;
    if (state.status !== 'paired') throw new Error('télé non appairée');
    return { token: state.token, id: state.screen.id };
  }
  const listen = (token: string, after = '') => call('GET', `/screen/events?after=${after}`, { from: TV, token, headers: PROTOCOL });

  /**
   * Le téléphone `token` commence à parler ; la télé reçoit l'événement et rend compte (`report`). Renvoie la réponse
   * au téléphone et l'événement reçu.
   */
  async function open(tv: { token: string; id: string }, token: string, report: object = { ok: true }, after = '0') {
    await listen(tv.token, after);
    const starting = call('POST', `/screens/${tv.id}/talk`, { token });
    for (let i = 0; i < 100; i++) {
      const { events } = (await (await listen(tv.token, after)).json()) as ScreenEvents;
      const event = events.find((e) => e.kind === 'talk');
      if (event) {
        await call('POST', `/screen/events/${event.id}/report`, { from: TV, token: tv.token, headers: PROTOCOL, body: report });
        return { response: await starting, event };
      }
    }
    throw new Error('aucun événement talk');
  }
  const pcm = (...bytes: number[]) => ({ raw: new Uint8Array(bytes), headers: { 'Content-Type': 'application/octet-stream' } });
  const speak = (tv: { id: string }, talkId: string, token: string, seq: number, ...bytes: number[]) =>
    call('POST', `/screens/${tv.id}/talk/${talkId}/audio?seq=${seq}`, { token, ...pcm(...bytes) });
  const hear = (tv: { token: string }, talkId: string, after = 0, token = tv.token) =>
    call('GET', `/screen/talk/${talkId}?after=${after}`, { from: TV, token, headers: PROTOCOL });

  return {
    call, pairTv, listen, open, speak, hear, talkService,
    alex: await phone('alex'), sam: await phone('sam'), lea: await phone('lea'),
    tabletParent: () => ({ from: TABLET, headers: { 'X-Actor-Session': sessions.open('alex', 10).token } }),
    advance: (ms: number) => (now += ms),
  };
}

describe('Parler en direct à la télé', () => {
  it('le téléphone d’un parent ouvre, la télé reçoit « Alex vous parle » puis la voix d’un bloc', async () => {
    const { pairTv, open, speak, hear, alex, talkService } = await setup();
    const tv = await pairTv();
    const { response, event } = await open(tv, alex);
    expect(response.status).toBe(201);
    const start = (await response.json()) as ScreenTalkStart;
    expect(start).toEqual({ id: expect.any(String), device: 'Télé du salon', rate: 16_000, maxSeconds: 600 });
    expect(event).toEqual(expect.objectContaining({ kind: 'talk', id: start.id, title: talkTitle('Alex'), audio: `/api/screen/talk/${start.id}`, rate: 16_000 }));
    expect(talkService.speakers()).toEqual(['Alex']);

    expect((await speak(tv, start.id, alex, 1, 1, 2)).status).toBe(204);
    expect((await speak(tv, start.id, alex, 2, 3, 4)).status).toBe(204);
    // Doublon (nouvel essai après un réseau perdu) : ignoré.
    expect((await speak(tv, start.id, alex, 2, 9, 9)).status).toBe(204);
    const first = await hear(tv, start.id);
    expect(first.status).toBe(200);
    expect(first.headers.get(TALK_SEQ_HEADER)).toBe('2');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

    // Rien de neuf : 204, même numéro.
    const empty = await hear(tv, start.id, 2);
    expect(empty.status).toBe(204);
    expect(empty.headers.get(TALK_SEQ_HEADER)).toBe('2');

    await speak(tv, start.id, alex, 3, 5, 6);
    expect(new Uint8Array(await (await hear(tv, start.id, 2)).arrayBuffer())).toEqual(new Uint8Array([5, 6]));
  });

  it('le parent arrête : la télé finit la phrase, puis 410 ; le téléphone ne peut plus envoyer', async () => {
    const { call, pairTv, open, speak, hear, alex } = await setup();
    const tv = await pairTv();
    const { id } = (await (await open(tv, alex)).response.json()) as ScreenTalkStart;
    await speak(tv, id, alex, 1, 7, 8);
    expect((await call('DELETE', `/screens/${tv.id}/talk/${id}`, { token: alex })).status).toBe(204);
    expect(new Uint8Array(await (await hear(tv, id)).arrayBuffer())).toEqual(new Uint8Array([7, 8]));
    const end = await hear(tv, id, 1);
    expect(end.status).toBe(410);
    expect(await end.json()).toEqual({ error: TALK_STOPPED });
    expect(await (await speak(tv, id, alex, 2, 1, 1)).json()).toEqual({ error: TALK_STOPPED });
    // Arrêter deux fois : sans effet.
    expect((await call('DELETE', `/screens/${tv.id}/talk/${id}`, { token: alex })).status).toBe(204);
  });

  it('plus de nouvelles du téléphone, ou de la télé : fin, chacun l’apprend à son appel suivant', async () => {
    const { pairTv, open, speak, hear, alex, advance } = await setup();
    const tv = await pairTv();
    const { id } = (await (await open(tv, alex)).response.json()) as ScreenTalkStart;
    advance(TALK_IDLE_MS + 1);
    expect(await (await hear(tv, id)).json()).toEqual({ error: TALK_PHONE_GONE });

    const again = (await (await open(tv, alex, { ok: true }, '1')).response.json()) as ScreenTalkStart;
    await hear(tv, again.id);
    advance(TALK_IDLE_MS + 1);
    expect(await (await speak(tv, again.id, alex, 1, 1, 1)).json()).toEqual({ error: TALK_SCREEN_GONE });
  });

  it('au bout de camera.maxMinutes : fin', async () => {
    const { pairTv, open, speak, hear, alex, advance } = await setup({ maxMinutes: 1 });
    const tv = await pairTv();
    const { id } = (await (await open(tv, alex)).response.json()) as ScreenTalkStart;
    for (let i = 1; i <= 13; i++) {
      advance(5_000);
      await speak(tv, id, alex, i, 0, 0);
      await hear(tv, id, i - 1);
    }
    expect(await (await speak(tv, id, alex, 14, 0, 0)).json()).toEqual({ error: 'Arrêtée au bout de 1 min' });
  });

  it('une voix à la fois : Sam est refusé pendant qu’Alex parle ; le même téléphone remplace sa prise', async () => {
    const { call, pairTv, open, hear, alex, sam } = await setup();
    const tv = await pairTv();
    const first = (await (await open(tv, alex)).response.json()) as ScreenTalkStart;
    expect(await (await call('POST', `/screens/${tv.id}/talk`, { token: sam })).json()).toEqual({ error: 'Alex parle déjà à Télé du salon' });
    const second = (await (await open(tv, alex, { ok: true }, '1')).response.json()) as ScreenTalkStart;
    expect(second.id).not.toBe(first.id);
    expect(await (await hear(tv, first.id)).json()).toEqual({ error: 'Remplacée' });
  });

  it('la télé ne peut pas (pas de son, télé absente) : 502 ou 503 avec la raison', async () => {
    const { call, pairTv, open, alex } = await setup();
    const tv = await pairTv();
    expect((await call('POST', `/screens/${tv.id}/talk`, { token: alex })).status).toBe(503);
    const { response } = await open(tv, alex, { ok: false, reason: 'son indisponible' });
    expect(await response.json()).toEqual({ error: 'Télé du salon : son indisponible' });
    expect((await call('POST', '/screens/inconnue/talk', { token: alex })).status).toBe(404);
  });

  it('droits : un enfant, la tablette, parler désactivé, une autre télé, un téléphone à la place de la télé', async () => {
    const { call, pairTv, open, hear, speak, alex, lea, sam, tabletParent } = await setup();
    const tv = await pairTv();
    expect(await (await call('POST', `/screens/${tv.id}/talk`, { token: lea })).json()).toEqual({ error: TALK_PARENTS_ONLY });
    expect(await (await call('POST', `/screens/${tv.id}/talk`, tabletParent())).json()).toEqual({ error: TALK_PHONE_ONLY });
    expect((await call('POST', `/screens/${tv.id}/talk`)).status).toBe(403);

    const { id } = (await (await open(tv, alex)).response.json()) as ScreenTalkStart;
    // Un téléphone ne lit pas la voix ; une autre télé non plus ; un autre parent n'envoie pas dans la prise d'Alex.
    expect(await (await hear(tv, id, 0, alex)).json()).toEqual({ error: UNKNOWN_SCREEN });
    const other = await pairTv();
    expect((await hear(other, id)).status).toBe(404);
    expect((await speak(tv, id, sam, 1, 1, 1)).status).toBe(404);
    expect((await call('GET', `/screen/talk/${id}?after=0`, { from: TV, token: tv.token })).status).toBe(426);
    expect((await speak(tv, id, alex, 1, 1)).status).toBe(400);
    expect((await call('POST', `/screens/${tv.id}/talk/${id}/audio`, { token: alex, ...{ raw: new Uint8Array([1, 2]) } })).status).toBe(400);

    const off = await setup({ talk: false });
    const offTv = await off.pairTv();
    expect(await (await off.call('POST', `/screens/${offTv.id}/talk`, { token: off.alex })).json()).toEqual({ error: TALK_OFF });
  });
});
