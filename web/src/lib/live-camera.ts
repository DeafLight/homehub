// Caméra en direct, côté navigateur. La tablette (`createLiveHost`) attend les demandes des parents et répond à
// chacune par une connexion WebRTC qui envoie sa caméra de face (et son micro si `camera.audio`), prise au partage de
// l'appareil sans l'ouvrir deux fois. Le téléphone (`createLiveViewer`) ouvre une diffusion, envoie son offre et
// montre ce qu'il reçoit ; il ferme la diffusion en partant. Le parent peut parler (`camera.talk`) : la piste audio
// du téléphone est prévue dès l'offre (vide tant qu'il ne parle pas, le micro y est branché au bouton Parler, sans
// renégocier) ; pendant qu'il parle, le son reçu de la tablette est coupé (pas d'écho). La tablette joue la voix après
// un carillon et l'annonce (bandeau « Alex parle »). Les messages passent par le serveur (signalisation),
// l'image et le son vont directement d'un appareil à l'autre, ou par le relais TURN hors de la maison.
import type { CameraMessage, CameraSession, IceCandidate, IceServer } from '../../../shared/camera.ts';
import type { Api } from './api.ts';
import { ApiError } from './api.ts';
import { cameraShare } from './camera-share.ts';
import { chime as doorChime } from './beep.ts';
import { cameraError, FRONT_CAMERA } from './face.ts';

export type PeerFactory = (config: RTCConfiguration) => RTCPeerConnection;

/** Délai avant de réessayer d'écouter après une erreur réseau. */
const RETRY_MS = 5_000;
/** Sans connexion établie au bout de ce temps : c'est raté (réseau qui bloque, pas de relais TURN). */
export const CONNECT_TIMEOUT_MS = 20_000;
export const CONNECT_FAILED = 'Connexion impossible avec la tablette. Hors de la maison, il faut le relais TURN (voir le README).';

const pause = (ms: number, abort: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    abort.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

const rtcConfig = (iceServers: IceServer[]): RTCConfiguration => ({ iceServers });

/** Candidat ICE à envoyer (null : fin de la collecte). */
const toCandidate = (c: RTCIceCandidate | null): IceCandidate | null =>
  c ? { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment } : null;

/** Ajoute un candidat reçu ; la fin de la collecte (null) n'a rien à ajouter. */
async function addCandidate(pc: RTCPeerConnection, candidate: IceCandidate | null) {
  if (candidate) await pc.addIceCandidate(candidate).catch(() => {});
}

/** Ce que la tablette envoie : la caméra de face et, si demandé et disponible, le micro. */
export type HostMedia = { stream: MediaStream; release: () => void };

/** Caméra de face partagée, et le micro s'il est demandé ; sans micro (refusé), l'image part seule. */
export async function frontMedia(audio: boolean): Promise<HostMedia> {
  const video = await cameraShare.acquire('user', FRONT_CAMERA);
  const mic = audio
    ? await cameraShare.acquire('microphone', { audio: { echoCancellation: true, noiseSuppression: true }, video: false }).catch(() => null)
    : null;
  return {
    stream: new MediaStream([...video.stream.getVideoTracks(), ...(mic?.stream.getAudioTracks() ?? [])]),
    release() {
      video.release();
      mic?.release();
    },
  };
}

type HostPeer = {
  viewerName: string;
  iceServers: IceServer[];
  audio: boolean;
  /** Le parent a le droit de parler (`camera.talk` à l'ouverture) ; sinon sa piste audio est ignorée. */
  talk: boolean;
  /** Voix reçue du téléphone (piste muette tant qu'il ne parle pas). */
  voice: MediaStream | null;
  /** Il parle, carillon passé : on joue sa voix et on l'annonce. */
  talking: boolean;
  /** Numéro du dernier « parle / ne parle plus » (un arrêt pendant le carillon l'emporte). */
  talkTicket: number;
  pc?: RTCPeerConnection;
  media?: HostMedia;
  /** Candidats arrivés avant l'offre. */
  pending: (IceCandidate | null)[];
};

export type LiveHost = { stop(): void };

/** Parent qui parle à la tablette : sa voix à jouer (null tant que la piste n'est pas arrivée). */
export type Talker = { session: string; name: string; voice: MediaStream | null };

/**
 * Tablette : écoute les demandes et diffuse. `onViewers` : prénoms des parents qui regardent (bandeau), à chaque
 * changement ; `onTalkers` : ceux qui parlent, avec leur voix, après le carillon (`chime`). `client` : identifiant de
 * cette page (plusieurs pages de tablette peuvent écouter).
 */
export function createLiveHost({
  api,
  client,
  createPeer,
  media = frontMedia,
  chime = doorChime,
  onViewers,
  onTalkers = () => {},
}: {
  api: Pick<Api, 'tabletCameraMessages' | 'sendTabletCameraSignal'>;
  client: string;
  createPeer: PeerFactory;
  media?: (audio: boolean) => Promise<HostMedia>;
  chime?: () => Promise<void>;
  onViewers: (names: string[]) => void;
  onTalkers?: (talkers: Talker[]) => void;
}): LiveHost {
  const peers = new Map<string, HostPeer>();
  const abort = new AbortController();
  let after: number | null = null;

  const changed = () => {
    onViewers([...peers.values()].map((p) => p.viewerName));
    onTalkers([...peers].filter(([, p]) => p.talking).map(([session, p]) => ({ session, name: p.viewerName, voice: p.voice })));
  };
  const send = (session: string, signal: Parameters<Api['sendTabletCameraSignal']>[2]) =>
    api.sendTabletCameraSignal(client, session, signal).catch(() => {});

  function close(session: string, bye?: string) {
    const peer = peers.get(session);
    if (!peer) return;
    peers.delete(session);
    peer.pc?.close();
    peer.media?.release();
    if (bye !== undefined) void send(session, { kind: 'bye', reason: bye });
    changed();
  }

  async function answer(session: string, peer: HostPeer, sdp: string) {
    const pc = createPeer(rtcConfig(peer.iceServers));
    peer.pc = pc;
    pc.onicecandidate = (e) => void send(session, { kind: 'candidate', candidate: toCandidate(e.candidate) });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') close(session, 'Connexion perdue');
    };
    pc.ontrack = (e) => {
      // La voix du parent, seulement s'il a le droit de parler.
      if (e.track.kind !== 'audio' || !peer.talk || !peers.has(session)) return;
      peer.voice = new MediaStream([e.track]);
      if (peer.talking) changed();
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      try {
        peer.media = await media(peer.audio);
      } catch (err) {
        return close(session, cameraError(err));
      }
      if (!peers.has(session)) return peer.media.release(); // fermée pendant l'ouverture de la caméra
      for (const track of peer.media.stream.getTracks()) pc.addTrack(track, peer.media.stream);
      const local = await pc.createAnswer();
      await pc.setLocalDescription(local);
      for (const candidate of peer.pending.splice(0)) await addCandidate(pc, candidate);
      await api.sendTabletCameraSignal(client, session, { kind: 'answer', sdp: local.sdp ?? '' });
    } catch (err) {
      // 409 : une autre page de la tablette a répondu la première.
      close(session, err instanceof ApiError && err.status === 409 ? undefined : 'Connexion impossible');
    }
  }

  /** Le parent se met à parler (carillon, puis sa voix et le bandeau) ou s'arrête. */
  async function talk(session: string, peer: HostPeer, on: boolean) {
    if (!peer.talk) return;
    const ticket = ++peer.talkTicket;
    if (!on) {
      if (peer.talking) {
        peer.talking = false;
        changed();
      }
      return;
    }
    if (peer.talking) return;
    await chime().catch(() => {});
    if (ticket !== peer.talkTicket || peers.get(session) !== peer) return;
    peer.talking = true;
    changed();
  }

  async function handle({ session, signal }: CameraMessage) {
    if (signal.kind === 'start') {
      peers.set(session, {
        viewerName: signal.viewerName,
        iceServers: signal.iceServers,
        audio: signal.audio,
        talk: signal.talk,
        voice: null,
        talking: false,
        talkTicket: 0,
        pending: [],
      });
      changed();
      return;
    }
    if (signal.kind === 'bye') return close(session);
    const peer = peers.get(session);
    if (!peer) return;
    if (signal.kind === 'offer') return answer(session, peer, signal.sdp);
    if (signal.kind === 'talk') return void talk(session, peer, signal.on); // le carillon ne retient pas les autres messages
    if (signal.kind === 'candidate') {
      if (peer.pc?.remoteDescription) await addCandidate(peer.pc, signal.candidate);
      else peer.pending.push(signal.candidate);
    }
  }

  void (async () => {
    while (!abort.signal.aborted) {
      try {
        const reply = await api.tabletCameraMessages(client, after, abort.signal);
        after = reply.last;
        for (const message of reply.messages) await handle(message);
      } catch {
        if (abort.signal.aborted) return;
        await pause(RETRY_MS, abort.signal);
      }
    }
  })();

  return {
    stop() {
      abort.abort();
      for (const session of [...peers.keys()]) close(session, 'Caméra arrêtée sur la tablette');
    },
  };
}

/**
 * État du téléphone. En direct : `audio` (le son de la tablette vient), `talk` (il peut parler), `talking` (il parle :
 * son micro part vers la tablette et le son reçu est coupé).
 */
export type ViewerState =
  | { phase: 'connecting' }
  | { phase: 'live'; audio: boolean; talk: boolean; talking: boolean }
  | { phase: 'ended'; message: string }
  | { phase: 'error'; message: string };

/** `talk(true)` : parler (micro demandé au premier appui) ; `talk(false)` : s'arrêter. Rejette avec un texte à montrer. */
export type LiveViewer = { stop(): void; talk(on: boolean): Promise<void> };

/** Micro du téléphone pour parler, avec annulation d'écho et réduction du bruit. */
export const phoneMicrophone = () =>
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });

/** Texte d'un micro qui ne s'ouvre pas. */
export function micError(err: unknown): string {
  const name = (err as Error | undefined)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Micro refusé : autorise-le pour HomeHub dans le navigateur.';
  if (name === 'NotFoundError') return 'Pas de micro sur ce téléphone.';
  return 'Micro indisponible.';
}

/**
 * Téléphone : ouvre une diffusion et la montre (`onStream`) ; `onState` suit la connexion. `stop` ferme la
 * diffusion (onglet quitté, page masquée) ; `talk` branche ou débranche le micro.
 */
export function createLiveViewer({
  api,
  createPeer,
  onState,
  onStream,
  microphone = phoneMicrophone,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
}: {
  api: Pick<Api, 'openCamera' | 'sendCameraSignal' | 'cameraMessages' | 'closeCamera'>;
  createPeer: PeerFactory;
  onState: (state: ViewerState) => void;
  onStream: (stream: MediaStream | null) => void;
  microphone?: () => Promise<MediaStream>;
  connectTimeoutMs?: number;
}): LiveViewer {
  const abort = new AbortController();
  let session: CameraSession | null = null;
  let pc: RTCPeerConnection | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let live = false;
  /** Où brancher le micro (piste audio prévue dès l'offre) ; null si parler n'est pas permis. */
  let sender: RTCRtpSender | null = null;
  let mic: MediaStream | null = null;
  let talking = false;
  /** Son reçu de la tablette : coupé pendant qu'on parle. */
  const heard: MediaStreamTrack[] = [];

  const report = () => {
    if (live && !finished && session) onState({ phase: 'live', audio: session.audio, talk: session.talk, talking });
  };
  const hear = (on: boolean) => {
    for (const track of heard) track.enabled = on;
  };
  const releaseMic = () => {
    for (const track of mic?.getTracks() ?? []) track.stop();
    mic = null;
  };
  /** Se tait : micro débranché et rendu, son de la tablette rétabli. */
  async function quiet() {
    talking = false;
    await sender?.replaceTrack(null).catch(() => {});
    releaseMic();
    hear(true);
    report();
  }

  async function talk(on: boolean) {
    if (finished || !session || !sender || on === talking) return;
    const id = session.id;
    if (!on) {
      await quiet();
      await api.sendCameraSignal(id, { kind: 'talk', on: false }).catch(() => {});
      return;
    }
    let stream: MediaStream;
    try {
      stream = await microphone();
    } catch (err) {
      throw new Error(micError(err));
    }
    if (finished || talking) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    mic = stream;
    talking = true;
    hear(false);
    report();
    try {
      await sender.replaceTrack(stream.getAudioTracks()[0] ?? null);
      await api.sendCameraSignal(id, { kind: 'talk', on: true });
    } catch (err) {
      // Refusé (camera.talk coupé entre-temps) : on se tait de nouveau.
      await quiet();
      throw err instanceof Error ? err : new Error('Impossible de parler à la tablette');
    }
  }

  function finish(state: Extract<ViewerState, { phase: 'ended' | 'error' }> | null, notifyServer: boolean) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    abort.abort();
    releaseMic();
    pc?.close();
    onStream(null);
    if (notifyServer && session) void api.closeCamera(session.id).catch(() => {});
    if (state) onState(state);
  }

  void (async () => {
    onState({ phase: 'connecting' });
    try {
      session = await api.openCamera();
    } catch (err) {
      return finish({ phase: 'error', message: (err as Error).message }, false);
    }
    if (finished) return void api.closeCamera(session.id).catch(() => {});
    const current = session;
    const peer = createPeer(rtcConfig(current.iceServers));
    pc = peer;
    peer.addTransceiver('video', { direction: 'recvonly' });
    if (current.audio || current.talk) {
      // Pour parler, la piste audio part aussi dans ce sens (vide tant qu'on ne parle pas).
      const direction = !current.talk ? 'recvonly' : current.audio ? 'sendrecv' : 'sendonly';
      const audio = peer.addTransceiver('audio', { direction });
      if (current.talk) sender = audio.sender;
    }
    const stream = new MediaStream();
    peer.ontrack = (e) => {
      if (e.track.kind === 'audio') {
        heard.push(e.track);
        e.track.enabled = !talking;
      }
      stream.addTrack(e.track);
      onStream(stream);
    };
    peer.onicecandidate = (e) => void api.sendCameraSignal(current.id, { kind: 'candidate', candidate: toCandidate(e.candidate) }).catch(() => {});
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        clearTimeout(timer);
        live = true;
        report();
      } else if (peer.connectionState === 'failed') {
        finish({ phase: 'error', message: CONNECT_FAILED }, true);
      }
    };
    timer = setTimeout(() => finish({ phase: 'error', message: CONNECT_FAILED }, true), connectTimeoutMs);

    const pending: (IceCandidate | null)[] = [];
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await api.sendCameraSignal(current.id, { kind: 'offer', sdp: offer.sdp ?? '' });
      let after = 0;
      while (!finished) {
        const { messages } = await api.cameraMessages(current.id, after, abort.signal);
        for (const { seq, signal } of messages) {
          after = Math.max(after, seq);
          if (signal.kind === 'answer') {
            await peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
            for (const candidate of pending.splice(0)) await addCandidate(peer, candidate);
          } else if (signal.kind === 'candidate') {
            if (peer.remoteDescription) await addCandidate(peer, signal.candidate);
            else pending.push(signal.candidate);
          } else if (signal.kind === 'bye') {
            return finish({ phase: 'ended', message: signal.reason ?? 'Diffusion terminée' }, false);
          }
        }
      }
    } catch (err) {
      if (finished) return;
      if (err instanceof ApiError && err.status === 404) return finish({ phase: 'ended', message: err.message }, false);
      finish({ phase: 'error', message: (err as Error).message }, true);
    }
  })();

  return { stop: () => finish(null, true), talk };
}

/** Identifiant de cette page (tablette), tiré au hasard à l'ouverture. */
export const pageClientId = () => crypto.randomUUID();
