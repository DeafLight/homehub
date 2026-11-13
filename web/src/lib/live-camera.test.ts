// Tests de la caméra en direct côté navigateur, avec de fausses connexions WebRTC et une fausse API : la tablette
// annonce qui regarde, répond à l'offre avec la caméra (candidats arrivés avant gardés), rend la caméra à la fin,
// signale une caméra refusée, laisse la diffusion à une autre page (409), arrête tout en partant ; le téléphone
// envoie son offre, passe en direct, montre le flux, s'arrête sur une fin de la tablette, ferme la diffusion en
// partant, signale un refus du serveur ou une connexion qui n'aboutit pas.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraMessage, CameraMessages, CameraSession, CameraSignal } from '../../../shared/camera.ts';
import { ApiError } from './api.ts';
import { CONNECT_FAILED, createLiveHost, createLiveViewer, type HostMedia } from './live-camera.ts';

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
  addTransceiver(kind: string, init: { direction: string }) {
    this.transceivers.push({ kind, direction: init.direction });
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

const START: CameraSignal = { kind: 'start', viewerId: 'alex', viewerName: 'Alex', iceServers: [{ urls: ['stun:maison.example.org'] }], audio: true };

function hostSetup({ media, answerFails }: { media?: (audio: boolean) => Promise<HostMedia>; answerFails?: ApiError } = {}) {
  const inbox = channel();
  const sent: { session: string; signal: CameraSignal }[] = [];
  const viewers: string[][] = [];
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
    onViewers: (names) => viewers.push(names),
  });
  return { inbox, sent, viewers, released, host };
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

function viewerSetup({ open, connectTimeoutMs }: { open?: () => Promise<CameraSession>; connectTimeoutMs?: number } = {}) {
  const inbox = channel();
  const sent: CameraSignal[] = [];
  const closed: string[] = [];
  const states: unknown[] = [];
  const streams: unknown[] = [];
  const viewer = createLiveViewer({
    api: {
      openCamera: open ?? (async () => ({ id: 's1', iceServers: [], audio: true, maxSeconds: 600 })),
      async sendCameraSignal(_id, signal) {
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
    expect(states).toEqual([{ phase: 'connecting' }, { phase: 'live', audio: true }]);
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
