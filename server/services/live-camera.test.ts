// Tests de la signalisation de la caméra en direct : identifiants TURN, ouverture (désactivée, tablette absente,
// une par téléphone, nombre maximal), échange offre / réponse / candidats, page de tablette qui prend la diffusion et
// celles qui sont congédiées, fins (téléphone, tablette, durée, téléphone ou tablette partis, réglage coupé), attente
// interrompue, page de tablette qui redémarre ; parole du parent relayée à la tablette, refusée quand le réglage la
// coupe, arrêtée si on le coupe pendant qu'il parle.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.ts';
import { HttpError } from '../http.ts';
import { NOW } from '../testing.ts';
import { CAMERA_DISABLED, GONE_MS, iceServersFor, MAX_SESSIONS, SESSION_ENDED, TABLET_OFFLINE, TALK_DISABLED, createLiveCamera, turnCredentials } from './live-camera.ts';

const rulesOf = (camera: unknown = {}) => parseConfig({ members: [{ id: 'alex', name: 'Alex', color: '#5b8def', parent: true }], camera }).camera;

function setup(camera: unknown = {}, turnSecret?: string) {
  let now = new Date(NOW);
  let rules = rulesOf(camera);
  const live = createLiveCamera({ clock: () => new Date(now), rules: () => rules, turnSecret, waitMs: 20 });
  const advance = (ms: number) => (now = new Date(now.getTime() + ms));
  const setRules = (value: unknown) => (rules = rulesOf(value));
  return { live, advance, setRules };
}

const ALEX = { viewerId: 'alex', viewerName: 'Alex', deviceId: 'tel-alex' };
const SAM = { viewerId: 'sam', viewerName: 'Sam', deviceId: 'tel-sam' };
const TAB = 'tablette-1';
const DEV = 'navigateur-2';

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, message: err.message };
    throw err;
  }
  return null;
};

/** La tablette écoute (une interrogation qui revient tout de suite ou au bout de l'attente). */
const listen = (live: ReturnType<typeof setup>['live'], client = TAB, after: number | null = null) => live.tabletMessages(client, after);

describe('identifiants TURN', () => {
  it('suivent l’API REST de coturn : expiration:libellé, HMAC-SHA1 en base64', () => {
    const { username, credential } = turnCredentials('secret', new Date(1_000_000_000_000), 3600);
    expect(username).toBe('1000003600:homehub');
    expect(credential).toBe(createHmac('sha1', 'secret').update('1000003600:homehub').digest('base64'));
  });

  it('TURN seulement avec le secret ; STUN tel quel', () => {
    const rules = rulesOf({ stun: ['stun:maison.example.org:3478'], turn: ['turn:maison.example.org:3478?transport=udp'] });
    expect(iceServersFor(rules, undefined, NOW)).toEqual([{ urls: ['stun:maison.example.org:3478'] }]);
    const servers = iceServersFor(rules, 's3cret', NOW);
    expect(servers[1]).toMatchObject({ urls: ['turn:maison.example.org:3478?transport=udp'], username: expect.stringMatching(/^\d+:homehub$/) });
  });
});

describe('caméra en direct : ouverture', () => {
  it('refusée quand le réglage la coupe, ou sans tablette qui écoute', async () => {
    const off = setup({ live: false });
    expect(refusal(() => off.live.open(ALEX))).toEqual({ status: 403, message: CAMERA_DISABLED });
    const { live, advance } = setup();
    expect(refusal(() => live.open(ALEX))).toEqual({ status: 503, message: TABLET_OFFLINE });
    await listen(live);
    expect(refusal(() => live.open(ALEX))).toBeNull();
    // Plus de nouvelles de la tablette depuis trop longtemps : de nouveau injoignable.
    advance(GONE_MS);
    expect(refusal(() => live.open(SAM))).toEqual({ status: 503, message: TABLET_OFFLINE });
  });

  it('annonce le parent à la tablette, avec les serveurs et le son', async () => {
    const { live } = setup({ audio: false, talk: false, maxMinutes: 5 }, undefined);
    await listen(live);
    const session = live.open(ALEX);
    expect(session).toMatchObject({ audio: false, talk: false, maxSeconds: 300, iceServers: [] });
    const { messages } = await listen(live, TAB, 0);
    expect(messages).toEqual([{ seq: 1, session: session.id, signal: { kind: 'start', viewerId: 'alex', viewerName: 'Alex', iceServers: [], audio: false, talk: false } }]);
    expect(live.viewers()).toEqual(['Alex']);
  });

  it('une diffusion par téléphone, et un nombre limité en tout', async () => {
    const { live } = setup();
    await listen(live);
    const first = live.open(ALEX);
    const second = live.open(ALEX);
    expect(live.viewers()).toEqual(['Alex']);
    expect((await live.phoneMessages(first.id, ALEX.deviceId, 0)).messages.map((m) => m.signal)).toEqual([{ kind: 'bye', reason: 'Remplacée' }]);
    expect(refusal(() => live.phoneSignal(first.id, ALEX.deviceId, { kind: 'candidate', candidate: null }))).toEqual({ status: 404, message: SESSION_ENDED });
    expect(second.id).not.toBe(first.id);
    for (let i = 1; i < MAX_SESSIONS; i++) live.open({ ...SAM, deviceId: `tel-${i}` });
    expect(refusal(() => live.open(SAM))?.status).toBe(409);
  });
});

describe('caméra en direct : échange', () => {
  it('offre et candidats vers la tablette, réponse et candidats vers le téléphone', async () => {
    const { live } = setup();
    await listen(live);
    const { id } = live.open(ALEX);
    live.phoneSignal(id, ALEX.deviceId, { kind: 'offer', sdp: 'v=0 offre' });
    live.phoneSignal(id, ALEX.deviceId, { kind: 'candidate', candidate: { candidate: 'candidate:1', sdpMid: '0' } });
    const tablet = await listen(live, TAB, 0);
    expect(tablet.messages.map((m) => m.signal.kind)).toEqual(['start', 'offer', 'candidate']);

    live.tabletSignal(TAB, id, { kind: 'answer', sdp: 'v=0 réponse' });
    live.tabletSignal(TAB, id, { kind: 'candidate', candidate: null });
    const phone = await live.phoneMessages(id, ALEX.deviceId, 0);
    expect(phone.messages.map((m) => m.signal)).toEqual([{ kind: 'answer', sdp: 'v=0 réponse' }, { kind: 'candidate', candidate: null }]);
    // Messages reçus (after) : oubliés, la suite seulement.
    expect((await live.phoneMessages(id, ALEX.deviceId, 2)).messages).toEqual([]);
  });

  it('l’attente du téléphone se réveille à l’arrivée de la réponse', async () => {
    const { live } = setup();
    await listen(live);
    const { id } = live.open(ALEX);
    const waiting = live.phoneMessages(id, ALEX.deviceId, 0);
    live.tabletSignal(TAB, id, { kind: 'answer', sdp: 'r' });
    expect((await waiting).messages).toHaveLength(1);
  });

  it('un autre téléphone ne lit ni n’écrit dans la diffusion', async () => {
    const { live } = setup();
    await listen(live);
    const { id } = live.open(ALEX);
    await expect(live.phoneMessages(id, SAM.deviceId, 0)).rejects.toMatchObject({ status: 404 });
    expect(refusal(() => live.phoneSignal(id, SAM.deviceId, { kind: 'bye' }))?.status).toBe(404);
  });

  it('la première page de tablette qui répond prend la diffusion, les autres sont congédiées', async () => {
    const { live } = setup();
    await listen(live, TAB);
    await listen(live, DEV);
    const { id } = live.open(ALEX);
    live.phoneSignal(id, ALEX.deviceId, { kind: 'offer', sdp: 'o' });
    live.tabletSignal(DEV, id, { kind: 'answer', sdp: 'r' });
    expect(refusal(() => live.tabletSignal(TAB, id, { kind: 'answer', sdp: 'r2' }))?.status).toBe(409);
    const other = await listen(live, TAB, 2);
    expect(other.messages.map((m) => m.signal)).toEqual([{ kind: 'bye', reason: 'Prise par une autre page de la tablette' }]);
    // La suite ne va qu'à celle qui l'a prise.
    live.phoneSignal(id, ALEX.deviceId, { kind: 'candidate', candidate: null });
    expect((await listen(live, TAB, other.last)).messages).toEqual([]);
    expect((await listen(live, DEV, 2)).messages.map((m) => m.signal.kind)).toEqual(['candidate']);
  });

  it('une page de tablette qui démarre ne voit que les diffusions en attente', async () => {
    const { live } = setup();
    await listen(live);
    const ended = live.open(ALEX);
    live.phoneSignal(ended.id, ALEX.deviceId, { kind: 'bye' });
    const waiting = live.open(SAM);
    const { messages } = await listen(live, DEV, null);
    expect(messages.map((m) => [m.session, m.signal.kind])).toEqual([[waiting.id, 'start']]);
  });

  it('une attente interrompue (requête abandonnée) rend la main tout de suite', async () => {
    const { live } = createLiveCameraSlow();
    const abort = new AbortController();
    const pending = live.tabletMessages(TAB, 0, abort.signal);
    abort.abort();
    expect((await pending).messages).toEqual([]);
  });
});

/** Attente longue (25 s par défaut) : seule l'interruption peut la terminer dans le temps d'un test. */
function createLiveCameraSlow() {
  return { live: createLiveCamera({ clock: () => new Date(NOW), rules: () => rulesOf() }) };
}

describe('caméra en direct : fins', () => {
  async function started(options: unknown = {}) {
    const s = setup(options);
    await listen(s.live);
    const session = s.live.open(ALEX);
    s.live.tabletSignal(TAB, session.id, { kind: 'answer', sdp: 'r' });
    return { ...s, id: session.id };
  }

  it('le téléphone ferme : la tablette reçoit la fin', async () => {
    const { live, id } = await started();
    live.phoneSignal(id, ALEX.deviceId, { kind: 'bye' });
    const { messages } = await listen(live, TAB, 1);
    expect(messages.map((m) => m.signal)).toEqual([{ kind: 'bye', reason: 'Fermée sur le téléphone' }]);
    expect(live.viewers()).toEqual([]);
  });

  it('la tablette arrête : le téléphone reçoit la fin', async () => {
    const { live, id } = await started();
    live.tabletSignal(TAB, id, { kind: 'bye', reason: 'Caméra indisponible' });
    const { messages } = await live.phoneMessages(id, ALEX.deviceId, 1);
    expect(messages.map((m) => m.signal)).toEqual([{ kind: 'bye', reason: 'Caméra indisponible' }]);
  });

  it('au bout de maxMinutes, les deux côtés reçoivent la fin', async () => {
    const { live, id, advance } = await started({ maxMinutes: 2 });
    const waiting = live.phoneMessages(id, ALEX.deviceId, 1);
    advance(120_000);
    live.sweep();
    expect((await waiting).messages.map((m) => m.signal)).toEqual([{ kind: 'bye', reason: 'Diffusion arrêtée au bout de 2 min' }]);
    expect(live.viewers()).toEqual([]);
  });

  it('téléphone qui ne demande plus rien (page masquée, réseau perdu) : fin', async () => {
    const { live, advance } = await started();
    advance(GONE_MS - 1);
    live.sweep();
    expect(live.viewers()).toEqual(['Alex']);
    advance(1);
    const { messages } = await listen(live, TAB, 1);
    expect(messages.map((m) => m.signal)).toEqual([{ kind: 'bye', reason: 'Téléphone parti' }]);
  });

  it('tablette qui ne demande plus rien : le téléphone reçoit la fin', async () => {
    const { live, id, advance } = await started();
    const waiting = live.phoneMessages(id, ALEX.deviceId, 1);
    advance(GONE_MS);
    live.sweep();
    expect((await waiting).messages.map((m) => m.signal)).toEqual([{ kind: 'bye', reason: TABLET_OFFLINE }]);
  });

  it('réglage coupé pendant la diffusion : fin', async () => {
    const { live, setRules } = await started();
    setRules({ live: false });
    live.sweep();
    expect(live.viewers()).toEqual([]);
  });
});

describe('caméra en direct : le parent parle', () => {
  async function started(options: unknown = {}) {
    const s = setup(options);
    await listen(s.live);
    const session = s.live.open(ALEX);
    s.live.tabletSignal(TAB, session.id, { kind: 'answer', sdp: 'r' });
    return { ...s, id: session.id };
  }

  it('« parle » puis « ne parle plus » arrivent à la tablette, une fois chacun', async () => {
    const { live, id } = await started();
    live.phoneSignal(id, ALEX.deviceId, { kind: 'talk', on: true });
    live.phoneSignal(id, ALEX.deviceId, { kind: 'talk', on: true });
    expect(live.talkers()).toEqual(['Alex']);
    live.phoneSignal(id, ALEX.deviceId, { kind: 'talk', on: false });
    expect(live.talkers()).toEqual([]);
    const { messages } = await listen(live, TAB, 1);
    expect(messages.map((m) => m.signal)).toEqual([
      { kind: 'talk', on: true },
      { kind: 'talk', on: false },
    ]);
  });

  it('réglage coupé : refusé, et rien n’arrive à la tablette', async () => {
    const { live, id } = await started({ talk: false });
    expect(refusal(() => live.phoneSignal(id, ALEX.deviceId, { kind: 'talk', on: true }))).toEqual({ status: 403, message: TALK_DISABLED });
    // S'arrêter reste permis (sans effet : il ne parlait pas).
    expect(refusal(() => live.phoneSignal(id, ALEX.deviceId, { kind: 'talk', on: false }))).toBeNull();
    const { messages } = await listen(live, TAB, 1);
    expect(messages).toEqual([]);
  });

  it('réglage coupé pendant qu’il parle : la tablette se tait, la diffusion continue', async () => {
    const { live, id, setRules } = await started();
    live.phoneSignal(id, ALEX.deviceId, { kind: 'talk', on: true });
    setRules({ talk: false });
    live.sweep();
    expect(live.talkers()).toEqual([]);
    expect(live.viewers()).toEqual(['Alex']);
    const { messages } = await listen(live, TAB, 3);
    expect(messages.map((m) => m.signal)).toEqual([{ kind: 'talk', on: false }]);
  });
});
