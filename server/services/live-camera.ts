// Caméra en direct : signalisation WebRTC entre le téléphone d'un parent et la tablette, en mémoire seulement. Chaque
// côté attend ses messages par interrogation longue (pas de canal poussé : rien de plus à faire passer par le proxy).
// Une diffusion s'arrête quand le téléphone ou la tablette la ferme, quand l'un d'eux ne demande plus ses messages
// (page masquée, réseau perdu), ou au bout de `camera.maxMinutes`. Plusieurs pages de tablette peuvent écouter (la
// tablette et un navigateur de développement) : la première qui répond garde la diffusion, les autres sont congédiées.
// Le parent peut parler (`camera.talk`) : le serveur relaie à la tablette « parle / ne parle plus » (carillon, bandeau),
// et le refuse quand le réglage est coupé. Le serveur ne voit ni l'image ni le son, et n'enregistre rien.
import { createHmac, randomUUID } from 'node:crypto';
import type { CameraMessage, CameraMessages, CameraSession, CameraSignal, IceServer, PhoneSignal, TabletSignal } from '../../shared/camera.ts';
import type { AppConfig } from '../config.ts';
import { fail } from '../http.ts';
import type { Clock } from '../sources/types.ts';

export type CameraRules = AppConfig['camera'];

/** Attente d'une interrogation longue, sous le délai des proxys (60 s pour Nginx). */
export const WAIT_MS = 25_000;
/** Sans nouvelle interrogation pendant ce temps, le téléphone ou la tablette est parti. */
export const GONE_MS = 40_000;
/** Diffusions simultanées au plus (une par téléphone). */
export const MAX_SESSIONS = 4;
/** Un message reste lisible au plus ce temps (une page de tablette qui revient ne rejoue pas l'histoire). */
const MESSAGE_TTL_MS = 120_000;

export const CAMERA_DISABLED = 'Caméra en direct désactivée (camera.live dans homehub.yaml)';
export const TABLET_OFFLINE = 'Tablette injoignable : elle est peut-être éteinte ou sur une autre page qu’HomeHub';
export const SESSION_ENDED = 'Diffusion terminée';
export const TALK_DISABLED = 'Parler à la tablette est désactivé (camera.talk dans homehub.yaml)';

/**
 * Identifiants TURN éphémères (API REST de coturn, `use-auth-secret`) : nom = date d'expiration (secondes Unix) et
 * libellé ; mot de passe = HMAC-SHA1 du nom par le secret partagé, en base64.
 */
export function turnCredentials(secret: string, now: Date, ttlSeconds: number, label = 'homehub'): { username: string; credential: string } {
  const username = `${Math.floor(now.getTime() / 1000) + ttlSeconds}:${label}`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
}

/** Serveurs STUN et TURN à donner aux deux côtés ; TURN seulement si le secret est connu. */
export function iceServersFor(rules: CameraRules, turnSecret: string | undefined, now: Date): IceServer[] {
  const servers: IceServer[] = [];
  if (rules.stun.length) servers.push({ urls: [...rules.stun] });
  if (rules.turn.length && turnSecret) {
    servers.push({ urls: [...rules.turn], ...turnCredentials(turnSecret, now, rules.maxMinutes * 60 + 3600) });
  }
  return servers;
}

type Waiter = () => void;

/** Messages numérotés et ceux qui les attendent. */
function createMailbox() {
  let seq = 0;
  let items: (CameraMessage & { at: number; visibleTo?: string; notFor?: string })[] = [];
  const waiters = new Set<Waiter>();
  return {
    get seq() {
      return seq;
    },
    get items() {
      return items;
    },
    push(session: string, signal: CameraSignal, at: number, scope: { visibleTo?: string; notFor?: string } = {}) {
      items.push({ seq: ++seq, session, signal, at, ...scope });
      for (const wake of waiters) wake();
      waiters.clear();
    },
    keep(test: (m: (typeof items)[number]) => boolean) {
      items = items.filter(test);
    },
    /** Attend un nouveau message (ou la fin du délai, ou l'abandon de la requête). */
    wait(ms: number, signal?: AbortSignal): Promise<void> {
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        waiters.add(done);
        signal?.addEventListener('abort', done, { once: true });
      });
    },
  };
}

type Session = {
  id: string;
  viewerId: string;
  viewerName: string;
  deviceId: string;
  startedAt: number;
  /** Dernière interrogation du téléphone ; `polling` : interrogations en cours. */
  phoneSeenAt: number;
  phonePolling: number;
  /** Page de la tablette qui a répondu. */
  claimedBy?: string;
  /** Le parent parle (dernier `talk` relayé). */
  talking: boolean;
  phone: ReturnType<typeof createMailbox>;
};

export type LiveCamera = ReturnType<typeof createLiveCamera>;

export function createLiveCamera({
  clock,
  rules,
  turnSecret,
  waitMs = WAIT_MS,
  goneMs = GONE_MS,
}: {
  clock: Clock;
  rules: () => CameraRules;
  /** Secret partagé avec coturn (HOMEHUB_TURN_SECRET) ; absent : pas de TURN, Wi-Fi de la maison seulement. */
  turnSecret?: string;
  waitMs?: number;
  goneMs?: number;
}) {
  const sessions = new Map<string, Session>();
  /** Diffusions finies depuis peu : le téléphone peut encore y lire la raison de la fin. */
  const ended = new Map<string, { session: Session; at: number }>();
  const tablet = createMailbox();
  /** Pages de la tablette : dernière interrogation et interrogations en cours. */
  const clients = new Map<string, { seenAt: number; polling: number }>();
  const now = () => clock().getTime();

  const clientAlive = (id: string | undefined) => {
    const client = id === undefined ? undefined : clients.get(id);
    return client !== undefined && (client.polling > 0 || now() - client.seenAt < goneMs);
  };

  /** Message du téléphone vers la page de la tablette qui a pris la diffusion (ou toutes, avant). */
  const toTablet = (session: Session, signal: CameraSignal) =>
    tablet.push(session.id, signal, now(), session.claimedBy ? { visibleTo: session.claimedBy } : {});

  function end(session: Session, reason: string, from: 'phone' | 'tablet' | 'server') {
    if (!sessions.delete(session.id)) return;
    ended.set(session.id, { session, at: now() });
    const bye: CameraSignal = { kind: 'bye', reason };
    if (from !== 'phone') session.phone.push(session.id, bye, now());
    if (from !== 'tablet') tablet.push(session.id, bye, now(), session.claimedBy ? { visibleTo: session.claimedBy } : {});
    // Les messages d'une diffusion finie ne servent plus, sauf son « bye ».
    tablet.keep((m) => m.session !== session.id || m.signal.kind === 'bye');
  }

  /** Ferme les diffusions dont un côté est parti ou dont le temps est écoulé ; oublie les vieux messages. */
  function sweep() {
    const t = now();
    for (const session of sessions.values()) {
      if (t - session.startedAt >= rules().maxMinutes * 60_000) end(session, `Diffusion arrêtée au bout de ${rules().maxMinutes} min`, 'server');
      else if (session.phonePolling === 0 && t - session.phoneSeenAt >= goneMs) end(session, 'Téléphone parti', 'server');
      else if (session.claimedBy !== undefined && !clientAlive(session.claimedBy)) end(session, TABLET_OFFLINE, 'server');
      else if (!rules().live) end(session, CAMERA_DISABLED, 'server');
      else if (session.talking && !rules().talk) {
        // Réglage coupé pendant que le parent parle : la tablette se tait.
        session.talking = false;
        toTablet(session, { kind: 'talk', on: false });
      }
    }
    tablet.keep((m) => t - m.at < MESSAGE_TTL_MS);
    for (const [id, gone] of ended) if (t - gone.at >= MESSAGE_TTL_MS) ended.delete(id);
    for (const [id, client] of clients) if (client.polling === 0 && t - client.seenAt >= MESSAGE_TTL_MS) clients.delete(id);
  }

  const tabletOnline = () => [...clients.keys()].some(clientAlive);

  function sessionOf(id: string, deviceId: string): Session {
    sweep();
    const session = sessions.get(id);
    return session && session.deviceId === deviceId ? session : fail(404, SESSION_ENDED);
  }

  /** Attend des messages après `after` ; `pick` choisit ceux qui concernent l'appelant. */
  async function collect(
    box: ReturnType<typeof createMailbox>,
    after: number,
    pick: (m: CameraMessage & { visibleTo?: string; notFor?: string }) => boolean,
    abort?: AbortSignal,
  ): Promise<CameraMessages & { last: number }> {
    // L'attente se compte en temps réel (l'horloge injectée sert aux délais de présence et de durée).
    const deadline = performance.now() + waitMs;
    const found = () => box.items.filter((m) => m.seq > after && pick(m)).map(({ seq, session, signal }) => ({ seq, session, signal }));
    let messages = found();
    while (!messages.length && !abort?.aborted && performance.now() < deadline) {
      await box.wait(deadline - performance.now(), abort);
      messages = found();
    }
    return { messages, last: box.seq };
  }

  return {
    tabletOnline,
    sweep,
    /** Prénoms des parents qui regardent (tests, diagnostic). */
    viewers: () => [...sessions.values()].map((s) => s.viewerName),

    /** Un parent ouvre l'onglet : nouvelle diffusion (celle du même téléphone, s'il y en avait une, est fermée). */
    open({ viewerId, viewerName, deviceId }: { viewerId: string; viewerName: string; deviceId: string }): CameraSession {
      sweep();
      const current = rules();
      if (!current.live) fail(403, CAMERA_DISABLED);
      if (!tabletOnline()) fail(503, TABLET_OFFLINE);
      for (const session of sessions.values()) if (session.deviceId === deviceId) end(session, 'Remplacée', 'server');
      if (sessions.size >= MAX_SESSIONS) fail(409, `${MAX_SESSIONS} diffusions au plus en même temps`);
      const t = now();
      const id = randomUUID();
      const session: Session = { id, viewerId, viewerName, deviceId, startedAt: t, phoneSeenAt: t, phonePolling: 0, talking: false, phone: createMailbox() };
      sessions.set(id, session);
      tablet.push(id, { kind: 'start', viewerId, viewerName, iceServers: iceServersFor(current, turnSecret, clock()), audio: current.audio, talk: current.talk }, t);
      return { id, iceServers: iceServersFor(current, turnSecret, clock()), audio: current.audio, talk: current.talk, maxSeconds: current.maxMinutes * 60 };
    },

    /** Prénoms des parents qui parlent (tests, diagnostic). */
    talkers: () => [...sessions.values()].filter((s) => s.talking).map((s) => s.viewerName),

    /** Offre, candidats, parole ou fin, envoyés par le téléphone qui a ouvert la diffusion. */
    phoneSignal(id: string, deviceId: string, signal: PhoneSignal) {
      const session = sessionOf(id, deviceId);
      session.phoneSeenAt = now();
      if (signal.kind === 'bye') return end(session, signal.reason ?? 'Fermée sur le téléphone', 'phone');
      if (signal.kind === 'talk') {
        if (signal.on && !rules().talk) return fail(403, TALK_DISABLED);
        if (signal.on === session.talking) return;
        session.talking = signal.on;
      }
      toTablet(session, signal);
    },

    /** Messages pour le téléphone (réponse, candidats de la tablette, fin) ; l'attente le tient pour présent. */
    async phoneMessages(id: string, deviceId: string, after: number, abort?: AbortSignal): Promise<CameraMessages> {
      sweep();
      const gone = ended.get(id)?.session;
      if (gone?.deviceId === deviceId) return { messages: gone.phone.items.filter((m) => m.seq > after).map(({ seq, session, signal }) => ({ seq, session, signal })) };
      const session = sessionOf(id, deviceId);
      session.phone.keep((m) => m.seq > after);
      session.phoneSeenAt = now();
      session.phonePolling++;
      try {
        const { messages } = await collect(session.phone, after, () => true, abort);
        return { messages };
      } finally {
        session.phonePolling--;
        session.phoneSeenAt = now();
      }
    },

    /**
     * Messages pour une page de la tablette. `after` absent (page qui démarre) : seulement les diffusions en attente,
     * sans les fins déjà passées. Une page ne voit plus une diffusion qu'une autre a prise.
     */
    async tabletMessages(client: string, after: number | null, abort?: AbortSignal): Promise<CameraMessages & { last: number }> {
      sweep();
      const entry = clients.get(client) ?? { seenAt: now(), polling: 0 };
      clients.set(client, entry);
      entry.seenAt = now();
      entry.polling++;
      try {
        const fresh = after === null;
        return await collect(
          tablet,
          after ?? 0,
          (m) => {
            if (m.visibleTo !== undefined && m.visibleTo !== client) return false;
            if (m.notFor === client) return false;
            if (!fresh) return true;
            const session = sessions.get(m.session);
            return session !== undefined && (session.claimedBy ?? client) === client;
          },
          abort,
        );
      } finally {
        entry.polling--;
        entry.seenAt = now();
      }
    },

    /** Réponse, candidats ou fin envoyés par une page de la tablette ; la première réponse prend la diffusion. */
    tabletSignal(client: string, id: string, signal: TabletSignal) {
      sweep();
      const session = sessions.get(id) ?? fail(404, SESSION_ENDED);
      const entry = clients.get(client);
      if (entry) entry.seenAt = now();
      if (session.claimedBy === undefined && signal.kind === 'answer') {
        session.claimedBy = client;
        tablet.push(id, { kind: 'bye', reason: 'Prise par une autre page de la tablette' }, now(), { notFor: client });
      }
      if (session.claimedBy !== client) {
        if (signal.kind === 'bye') return;
        return fail(409, 'Diffusion prise par une autre page de la tablette');
      }
      if (signal.kind === 'bye') return end(session, signal.reason ?? 'Arrêtée sur la tablette', 'tablet');
      session.phone.push(id, signal, now());
    },
  };
}
