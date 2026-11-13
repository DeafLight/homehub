// Tests de la caméra en direct côté navigateur, avec de fausses connexions WebRTC et une fausse API : la tablette
// annonce qui regarde, répond à l'offre avec la caméra (candidats arrivés avant gardés), rend la caméra à la fin,
// signale une caméra refusée, laisse la diffusion à une autre page (409), arrête tout en partant ; le téléphone
// envoie son offre, passe en direct, montre le flux, s'arrête sur une fin de la tablette, ferme la diffusion en
// partant, signale un refus du serveur ou une connexion qui n'aboutit pas. Parler : le téléphone prévoit sa piste
// audio dès l'offre, y branche le micro, coupe le son reçu pendant qu'il parle et le rétablit ensuite (micro refusé,
// refus du serveur) ; la tablette joue la voix après le carillon et annonce le parent, s'arrête avec lui, et ignore
// tout quand parler n'est pas permis.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraMessage, CameraMessages, CameraSession, CameraSignal } from '../../../shared/camera.ts';
import { ApiError } from './api.ts';
import { CONNECT_FAILED, createLiveHost, createLiveViewer, type HostMedia, type Talker } from './live-camera.ts';

class FakePeer {
  static all: FakePeer[] = [];
  transceivers: { kind: string; direction: string }[] = [];
  tracks: unknown[] = [];
  candidates: unknown[] = [];
  local: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  closed = false;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: { track: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor(readonly config: RTCConfiguration) {
    FakePeer.all.push(this);
  }
  /** Pistes branchées sur l'émetteur audio (replaceTrack), dans l'ordre. */
  replaced: unknown[] = [];
  addTransceiver(kind: string, init: { direction: string }) {
    this.transceivers.push({ kind, direction: init.direction });
    return { sender: { replaceTrack: async (track: unknown) => void this.replaced.push(track) } };
  }
  async createOffer() {
    return { type: 'offer' as const, sdp: 'offre' };
  }
  async createAnswer() {
    return { type: 'answer' as const, sdp: 'réponse' };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.local = d;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d;
  }
  async addIceCandidate(c: unknown) {
    this.candidates.push(c);
  }
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
  close() {
    this.closed = true;
  }
  setState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}
const createPeer = (config: RTCConfiguration) => new FakePeer(config) as unknown as RTCPeerConnection;

class FakeStream {
  tracks: unknown[];
  constructor(tracks: unknown[] = []) {
    this.tracks = [...tracks];
  }
  addTrack(t: unknown) {
    this.tracks.push(t);
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => (t as FakeTrack).kind === 'audio');
  }
}

class FakeTrack {
  enabled = true;
  stopped = false;
  constructor(readonly kind: 'audio' | 'video') {}
  stop() {
    this.stopped = true;
  }
}

beforeEach(() => {
  FakePeer.all = [];
  vi.stubGlobal('MediaStream', FakeStream);
});
afterEach(() => vi.unstubAllGlobals());

/** Laisse passer les promesses en attente. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** File de messages : chaque attente reçoit le prochain lot poussé par le test. */
function channel() {
  const queue: CameraMessage[][] = [];
  let wake: (() => void) | null = null;
  let seq = 0;
  return {
    push(session: string, ...signals: CameraSignal[]) {
      queue.push(signals.map((signal) => ({ seq: ++seq, session, signal })));
      wake?.();
    },
    async next(abort?: AbortSignal): Promise<CameraMessages & { last: number }> {
      while (!queue.length) {
        if (abort?.aborted) return { messages: [], last: seq };
        await new Promise<void>((resolve) => {
          wake = resolve;
          abort?.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      return { messages: queue.shift()!, last: seq };
    },
  };
}

const START: CameraSignal = { kind: 'start', viewerId: 'alex', viewerName: 'Alex', iceServers: [{ urls: ['stun:maison.example.org'] }], audio: true, talk: true };

function hostSetup({ media, answerFails, chime }: { media?: (audio: boolean) => Promise<HostMedia>; answerFails?: ApiError; chime?: () => Promise<void> } = {}) {
  const inbox = channel();
  const sent: { session: string; signal: CameraSignal }[] = [];
  const viewers: string[][] = [];
  const talkers: Talker[][] = [];
  const released: boolean[] = [];
  const host = createLiveHost({
    api: {
      tabletCameraMessages: (_client, _after, abort) => inbox.next(abort),
      async sendTabletCameraSignal(_client, session, signal) {
        if (signal.kind === 'answer' && answerFails) throw answerFails;
        sent.push({ session, signal });
      },
    },
    client: 'page-1',
    createPeer,
    media:
      media ??
      (async (audio) => {
        const index = released.push(false) - 1;
        return { stream: new FakeStream(audio ? ['video', 'audio'] : ['video']) as unknown as MediaStream, release: () => (released[index] = true) };
      }),
    chime: chime ?? (async () => {}),
    onViewers: (names) => viewers.push(names),
    onTalkers: (list) => talkers.push(list),
  });
  return { inbox, sent, viewers, talkers, released, host };
}

describe('caméra en direct : tablette', () => {
  it('annonce qui regarde, répond à l’offre avec la caméra et le micro', async () => {
    const { inbox, sent, viewers, released } = hostSetup();
    inbox.push('s1', START, { kind: 'candidate', candidate: { candidate: 'avant', sdpMid: '0' } }, { kind: 'offer', sdp: 'offre' });
    await settle();
    expect(viewers.at(0)).toEqual(['Alex']);
    const [peer] = FakePeer.all;
    expect(peer.config).toEqual({ iceServers: [{ urls: ['stun:maison.example.org'] }] });
    expect(peer.remoteDescription).toEqual({ type: 'offer', sdp: 'offre' });
    expect(peer.tracks).toEqual(['video', 'audio']);
    expect(peer.candidates).toEqual([{ candidate: 'avant', sdpMid: '0' }]);
    expect(sent).toEqual([{ session: 's1', signal: { kind: 'answer', sdp: 'réponse' } }]);
    peer.onicecandidate?.({ candidate: { candidate: 'tablette', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'u' } });
    expect(sent.at(-1)?.signal).toMatchObject({ kind: 'candidate', candidate: { candidate: 'tablette' } });

    inbox.push('s1', { kind: 'bye', reason: 'Fermée sur le téléphone' });
    await settle();
    expect(peer.closed).toBe(true);
    expect(released).toEqual([true]);
    expect(viewers.at(-1)).toEqual([]);
  });

  it('caméra refusée : la fin part vers le téléphone avec la raison', async () => {
    const denied = Object.assign(new Error('non'), { name: 'NotAllowedError' });
    const { inbox, sent, viewers } = hostSetup({ media: () => Promise.reject(denied) });
    inbox.push('s1', START, { kind: 'offer', sdp: 'offre' });
    await settle();
    expect(sent).toEqual([{ session: 's1', signal: { kind: 'bye', reason: expect.stringContaining('Caméra refusée') } }]);
    expect(viewers.at(-1)).toEqual([]);
  });

  it('une autre page a répondu la première (409) : on s’efface sans fin', async () => {
    const { inbox, sent, released } = hostSetup({ answerFails: new ApiError(409, 'prise') });
    inbox.push('s1', START, { kind: 'offer', sdp: 'offre' });
    await settle();
    expect(sent).toEqual([]);
    expect(released).toEqual([true]);
    expect(FakePeer.all[0].closed).toBe(true);
  });

  it('arrêtée (page quittée) : chaque diffusion reçoit sa fin et la caméra est rendue', async () => {
    const { inbox, sent, released, host } = hostSetup();
    inbox.push('s1', START, { kind: 'offer', sdp: 'offre' });
    await settle();
    host.stop();
    expect(sent.at(-1)).toEqual({ session: 's1', signal: { kind: 'bye', reason: 'Caméra arrêtée sur la tablette' } });
    expect(released).toEqual([true]);
  });
});

describe('caméra en direct : tablette, le parent parle', () => {
  /** Carillon tenu par le test : la voix ne démarre qu'à sa fin. */
  function heldChime() {
    let ring: (() => void) | null = null;
    return { chime: () => new Promise<void>((resolve) => (ring = resolve)), ring: () => ring?.() };
  }

  it('carillon, puis la voix jouée et le parent annoncé ; il s’arrête : plus rien', async () => {
    const bell = heldChime();
    const { inbox, talkers } = hostSetup({ chime: bell.chime });
    inbox.push('s1', START, { kind: 'offer', sdp: 'offre' });
    await settle();
    const voice = new FakeTrack('audio');
    FakePeer.all[0].ontrack?.({ track: voice });
    inbox.push('s1', { kind: 'talk', on: true });
    await settle();
    expect(talkers.at(-1)).toEqual([]); // pendant le carillon : pas encore
    bell.ring();
    await settle();
    expect(talkers.at(-1)).toEqual([{ session: 's1', name: 'Alex', voice: expect.objectContaining({ tracks: [voice] }) }]);
    inbox.push('s1', { kind: 'talk', on: false });
    await settle();
    expect(talkers.at(-1)).toEqual([]);
  });

  it('arrêt pendant le carillon : la voix ne démarre pas', async () => {
    const bell = heldChime();
    const { inbox, talkers } = hostSetup({ chime: bell.chime });
    inbox.push('s1', START, { kind: 'offer', sdp: 'offre' });
    await settle();
    inbox.push('s1', { kind: 'talk', on: true });
    await settle();
    inbox.push('s1', { kind: 'talk', on: false });
    await settle();
    bell.ring();
    await settle();
    expect(talkers.every((list) => list.length === 0)).toBe(true);
  });

  it('diffusion finie pendant qu’il parle : plus personne n’est annoncé', async () => {
    const { inbox, talkers } = hostSetup();
    inbox.push('s1', START, { kind: 'offer', sdp: 'offre' }, { kind: 'talk', on: true });
    await settle();
    expect(talkers.at(-1)).toMatchObject([{ name: 'Alex' }]);
    inbox.push('s1', { kind: 'bye' });
    await settle();
    expect(talkers.at(-1)).toEqual([]);
  });

  it('parler non permis (camera.talk coupé) : la piste et l’annonce sont ignorées', async () => {
    const { inbox, talkers } = hostSetup();
    inbox.push('s1', { ...START, talk: false } as CameraSignal, { kind: 'offer', sdp: 'offre' });
    await settle();
    FakePeer.all[0].ontrack?.({ track: new FakeTrack('audio') });
    inbox.push('s1', { kind: 'talk', on: true });
    await settle();
    expect(talkers.every((list) => list.length === 0)).toBe(true);
  });
});

function viewerSetup({
  open,
  connectTimeoutMs,
  microphone,
  refuseTalk,
}: { open?: () => Promise<CameraSession>; connectTimeoutMs?: number; microphone?: () => Promise<MediaStream>; refuseTalk?: boolean } = {}) {
  const inbox = channel();
  const sent: CameraSignal[] = [];
  const closed: string[] = [];
  const states: unknown[] = [];
  const streams: unknown[] = [];
  const viewer = createLiveViewer({
    api: {
      openCamera: open ?? (async () => ({ id: 's1', iceServers: [], audio: true, talk: false, maxSeconds: 600 })),
      async sendCameraSignal(_id, signal) {
        if (signal.kind === 'talk' && signal.on && refuseTalk) throw new ApiError(403, 'Parler à la tablette est désactivé');
        sent.push(signal);
      },
      cameraMessages: (_id, _after, abort) => inbox.next(abort),
      async closeCamera(id) {
        closed.push(id);
      },
    },
    createPeer,
    onState: (s) => states.push(s),
    onStream: (s) => streams.push(s),
    microphone,
    connectTimeoutMs,
  });
  return { inbox, sent, closed, states, streams, viewer };
}

describe('caméra en direct : téléphone', () => {
  it('envoie son offre (image et son en réception), passe en direct et montre le flux', async () => {
    const { inbox, sent, states, streams, viewer } = viewerSetup();
    await settle();
    const [peer] = FakePeer.all;
    expect(peer.transceivers).toEqual([
      { kind: 'video', direction: 'recvonly' },
      { kind: 'audio', direction: 'recvonly' },
    ]);
    expect(sent).toEqual([{ kind: 'offer', sdp: 'offre' }]);
    inbox.push('s1', { kind: 'candidate', candidate: { candidate: 'tôt' } }, { kind: 'answer', sdp: 'réponse' });
    await settle();
    expect(peer.remoteDescription).toEqual({ type: 'answer', sdp: 'réponse' });
    expect(peer.candidates).toEqual([{ candidate: 'tôt' }]);
    peer.ontrack?.({ track: 'video' });
    peer.setState('connected');
    expect(states).toEqual([{ phase: 'connecting' }, { phase: 'live', audio: true, talk: false, talking: false }]);
    expect((streams.at(-1) as FakeStream).tracks).toEqual(['video']);
    viewer.stop();
  });

  it('fin venue de la tablette ou du serveur : terminée, sans refermer', async () => {
    const { inbox, closed, states, streams } = viewerSetup();
    await settle();
    inbox.push('s1', { kind: 'bye', reason: 'Diffusion arrêtée au bout de 10 min' });
    await settle();
    expect(states.at(-1)).toEqual({ phase: 'ended', message: 'Diffusion arrêtée au bout de 10 min' });
    expect(closed).toEqual([]);
    expect(streams.at(-1)).toBeNull();
    expect(FakePeer.all[0].closed).toBe(true);
  });

  it('onglet quitté ou page masquée : la diffusion est fermée', async () => {
    const { closed, viewer } = viewerSetup();
    await settle();
    viewer.stop();
    expect(closed).toEqual(['s1']);
    expect(FakePeer.all[0].closed).toBe(true);
  });

  it('refus du serveur (tablette injoignable) : l’erreur telle quelle', async () => {
    const { states } = viewerSetup({ open: () => Promise.reject(new ApiError(503, 'Tablette injoignable')) });
    await settle();
    expect(states).toEqual([{ phase: 'connecting' }, { phase: 'error', message: 'Tablette injoignable' }]);
  });

  it('connexion qui n’aboutit pas : erreur et diffusion fermée', async () => {
    const { states, closed } = viewerSetup({ connectTimeoutMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(states.at(-1)).toEqual({ phase: 'error', message: CONNECT_FAILED });
    expect(closed).toEqual(['s1']);
  });
});

describe('caméra en direct : téléphone, parler', () => {
  const TALKING: CameraSession = { id: 's1', iceServers: [], audio: true, talk: true, maxSeconds: 600 };

  /** Diffusion en direct où parler est permis, avec le son de la tablette reçu. */
  async function live(options: Parameters<typeof viewerSetup>[0] = {}) {
    const mic = new FakeTrack('audio');
    const setup = viewerSetup({ open: async () => TALKING, microphone: async () => new FakeStream([mic]) as unknown as MediaStream, ...options });
    await settle();
    const peer = FakePeer.all[0];
    const heard = new FakeTrack('audio');
    peer.ontrack?.({ track: heard });
    peer.setState('connected');
    return { ...setup, peer, heard, mic };
  }

  it('piste audio prévue dès l’offre ; parler branche le micro et coupe le son reçu, s’arrêter le rétablit', async () => {
    const { peer, heard, mic, sent, states, viewer } = await live();
    expect(peer.transceivers).toEqual([
      { kind: 'video', direction: 'recvonly' },
      { kind: 'audio', direction: 'sendrecv' },
    ]);
    expect(states.at(-1)).toEqual({ phase: 'live', audio: true, talk: true, talking: false });

    await viewer.talk(true);
    expect(peer.replaced).toEqual([mic]);
    expect(heard.enabled).toBe(false);
    expect(sent.at(-1)).toEqual({ kind: 'talk', on: true });
    expect(states.at(-1)).toEqual({ phase: 'live', audio: true, talk: true, talking: true });

    await viewer.talk(false);
    expect(peer.replaced).toEqual([mic, null]);
    expect(mic.stopped).toBe(true);
    expect(heard.enabled).toBe(true);
    expect(sent.at(-1)).toEqual({ kind: 'talk', on: false });
    expect(states.at(-1)).toMatchObject({ talking: false });
    viewer.stop();
  });

  it('un son de la tablette arrivé pendant qu’on parle reste coupé', async () => {
    const { peer, viewer } = await live();
    await viewer.talk(true);
    const late = new FakeTrack('audio');
    peer.ontrack?.({ track: late });
    expect(late.enabled).toBe(false);
    viewer.stop();
  });

  it('micro refusé : un texte clair, rien n’est envoyé', async () => {
    const denied = Object.assign(new Error('non'), { name: 'NotAllowedError' });
    const { peer, heard, sent, viewer } = await live({ microphone: () => Promise.reject(denied) });
    await expect(viewer.talk(true)).rejects.toThrow('Micro refusé');
    expect(peer.replaced).toEqual([]);
    expect(heard.enabled).toBe(true);
    expect(sent.some((s) => s.kind === 'talk')).toBe(false);
    viewer.stop();
  });

  it('refus du serveur : on se tait de nouveau, le son revient', async () => {
    const { peer, heard, mic, states, viewer } = await live({ refuseTalk: true });
    await expect(viewer.talk(true)).rejects.toThrow('désactivé');
    expect(peer.replaced).toEqual([mic, null]);
    expect(mic.stopped).toBe(true);
    expect(heard.enabled).toBe(true);
    expect(states.at(-1)).toMatchObject({ talking: false });
    viewer.stop();
  });

  it('diffusion fermée pendant qu’on parle : le micro est rendu', async () => {
    const { mic, viewer } = await live();
    await viewer.talk(true);
    viewer.stop();
    expect(mic.stopped).toBe(true);
  });

  it('parler non permis : l’offre reste en réception seule et le bouton ne fait rien', async () => {
    const { sent, viewer } = viewerSetup();
    await settle();
    expect(FakePeer.all[0].transceivers.find((t) => t.kind === 'audio')?.direction).toBe('recvonly');
    await viewer.talk(true);
    expect(sent.some((s) => s.kind === 'talk')).toBe(false);
    viewer.stop();
  });

  it('parler sans le son de la tablette : piste audio en émission seule', async () => {
    viewerSetup({ open: async () => ({ ...TALKING, audio: false }) });
    await settle();
    expect(FakePeer.all[0].transceivers).toEqual([
      { kind: 'video', direction: 'recvonly' },
      { kind: 'audio', direction: 'sendonly' },
    ]);
  });
});
