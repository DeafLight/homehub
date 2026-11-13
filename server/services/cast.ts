// Client Cast v2 minimal, sans dépendance : fait lire une adresse audio par un appareil Google Cast du réseau local
// (Google Home, Nest, télé Android TV avec Chromecast intégré). Protocole publié : connexion TLS sur le port 8009,
// messages CastMessage (protobuf, écrits ici à la main) précédés de leur longueur sur 4 octets ; on lance le récepteur
// média par défaut de Google (Default Media Receiver), puis on lui demande de charger l'adresse. L'appareil présente
// un certificat auto-signé, comme pour tout émetteur Cast local : on ne vérifie pas de chaîne de confiance (le
// protocole prévoit une authentification de l'appareil, facultative, que l'on n'utilise pas).
import { connect as tlsConnect } from 'node:tls';
import type { Duplex } from 'node:stream';

/** Récepteur média par défaut de Google : lit une adresse audio ou vidéo, sans appli à publier. */
export const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';

const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
} as const;

/** Un message Cast, la charge utile étant toujours du texte (JSON). */
export type CastMessage = { source: string; destination: string; namespace: string; payload: string };

// --- Protobuf de CastMessage : 1 protocol_version (varint, 0), 2 source_id, 3 destination_id, 4 namespace,
// 5 payload_type (varint, 0 : texte), 6 payload_utf8, 7 payload_binary (ignoré).

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

const stringField = (field: number, value: string) => {
  const data = Buffer.from(value, 'utf8');
  return Buffer.concat([varint((field << 3) | 2), varint(data.length), data]);
};

/** Encode un message, avec sa longueur en tête (prêt à écrire sur la connexion). */
export function encodeCastMessage(m: CastMessage): Buffer {
  const body = Buffer.concat([
    varint((1 << 3) | 0), varint(0),
    stringField(2, m.source),
    stringField(3, m.destination),
    stringField(4, m.namespace),
    varint((5 << 3) | 0), varint(0),
    stringField(6, m.payload),
  ]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}

/** Décode le corps d'un message (sans sa longueur) ; lève une erreur sur des données mal formées. */
export function decodeCastMessage(body: Buffer): CastMessage {
  const out: CastMessage = { source: '', destination: '', namespace: '', payload: '' };
  let i = 0;
  const readVarint = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (i >= body.length || shift > 28) throw new Error('Message Cast mal formé');
      const byte = body[i++]!;
      result |= (byte & 0x7f) << shift;
      if (byte < 0x80) return result >>> 0;
      shift += 7;
    }
  };
  while (i < body.length) {
    const key = readVarint();
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      readVarint();
    } else if (wire === 2) {
      const length = readVarint();
      if (i + length > body.length) throw new Error('Message Cast mal formé');
      const text = body.subarray(i, i + length).toString('utf8');
      i += length;
      if (field === 2) out.source = text;
      else if (field === 3) out.destination = text;
      else if (field === 4) out.namespace = text;
      else if (field === 6) out.payload = text;
    } else {
      throw new Error('Message Cast mal formé');
    }
  }
  return out;
}

/** Découpe le flux reçu en messages (ils peuvent arriver par morceaux ou plusieurs à la fois). */
export function castFramer(onMessage: (m: CastMessage) => void): (chunk: Buffer) => void {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt32BE(0);
      if (length > 1_000_000) throw new Error('Message Cast trop long');
      if (pending.length < 4 + length) return;
      const body = pending.subarray(4, 4 + length);
      pending = pending.subarray(4 + length);
      onMessage(decodeCastMessage(body));
    }
  };
}

/** Ce qu'il faut lire : adresse joignable par l'appareil, type du fichier, titre affiché (télé). */
export type CastMedia = { url: string; contentType: string; title: string };
export type CastTarget = { host: string; port: number };
/** Ouvre la connexion vers l'appareil (remplaçable dans les tests). */
export type CastConnect = (target: CastTarget) => Duplex;

export const tlsCastConnect: CastConnect = ({ host, port }) =>
  // Certificat auto-signé de l'appareil : voir l'en-tête.
  tlsConnect({ host, port, rejectUnauthorized: false });

/** Durée maximale pendant laquelle on reste connecté pour laisser le message se lire jusqu'au bout. */
export const CAST_LINGER_MS = 120_000;

type MediaStatus = { playerState?: string; idleReason?: string };

/**
 * Fait lire `media` par l'appareil : connexion, lancement du récepteur par défaut, chargement. Résout quand la lecture
 * a démarré (PLAYING) ; rejette avec un message pour l'écran (injoignable, refus de chargement, erreur de lecture,
 * délai dépassé). On reste ensuite connecté, en tâche de fond, jusqu'à la fin de la lecture (ou `lingerMs`), puis on
 * coupe la connexion SANS envoyer CLOSE : le récepteur par défaut s'arrête quand le dernier émetteur se déconnecte
 * volontairement, ce qui coupait le message avant même qu'il soit téléchargé (bip de connexion, puis rien).
 */
export function castPlay(
  target: CastTarget,
  media: CastMedia,
  { connect = tlsCastConnect, timeoutMs = 15_000, lingerMs = CAST_LINGER_MS }: { connect?: CastConnect; timeoutMs?: number; lingerMs?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const sender = `sender-homehub-${Math.random().toString(36).slice(2, 10)}`;
    let requestId = 1;
    let transport: string | null = null;
    let launchId = 0;
    let loadId = 0;
    let settled = false;
    let closed = false;
    const socket = connect(target);

    // Fin de la connexion : jamais de CLOSE (voir plus haut), on coupe simplement.
    const hangUp = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      clearTimeout(linger);
      socket.destroy();
    };
    /** Réponse à l'appelant : succès quand la lecture démarre, sinon l'erreur (et on raccroche). */
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        hangUp();
        reject(err);
      } else {
        linger = setTimeout(hangUp, lingerMs);
        resolve();
      }
    };
    const timer = setTimeout(() => settle(new Error('l’appareil ne répond pas ou ne lit pas le message')), timeoutMs);
    let linger: ReturnType<typeof setTimeout> | undefined;

    function send(destination: string, namespace: string, payload: Record<string, unknown>) {
      if (!closed) socket.write(encodeCastMessage({ source: sender, destination, namespace, payload: JSON.stringify(payload) }));
    }

    const onMediaStatus = (status: MediaStatus) => {
      if (status.playerState === 'PLAYING') return settle();
      if (status.playerState !== 'IDLE' || !status.idleReason) return; // chargement, mise en mémoire tampon
      if (status.idleReason === 'ERROR') settle(new Error('l’appareil ne sait pas lire ce message'));
      else settle(new Error('lecture interrompue sur l’appareil'));
      hangUp(); // FINISHED, CANCELLED, INTERRUPTED : la lecture est finie, on peut partir.
    };

    const framer = castFramer((m) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(m.payload) as Record<string, unknown>;
      } catch {
        return;
      }
      if (m.namespace === NS.heartbeat && data.type === 'PING') {
        send(m.source, NS.heartbeat, { type: 'PONG' });
      } else if (m.namespace === NS.connection && data.type === 'CLOSE' && (m.source === transport || m.source === 'receiver-0')) {
        settle(new Error('l’appareil a fermé la lecture'));
        hangUp();
      } else if (m.namespace === NS.receiver && data.type === 'RECEIVER_STATUS' && transport === null) {
        const apps = (data.status as { applications?: { appId?: string; transportId?: string }[] } | undefined)?.applications ?? [];
        const app = apps.find((a) => a.appId === DEFAULT_MEDIA_RECEIVER && a.transportId);
        if (!app) return; // Pas encore lancé : on attend le statut suivant.
        transport = app.transportId!;
        send(transport, NS.connection, { type: 'CONNECT' });
        loadId = requestId++;
        send(transport, NS.media, {
          type: 'LOAD',
          requestId: loadId,
          autoplay: true,
          currentTime: 0,
          media: { contentId: media.url, contentType: media.contentType, streamType: 'BUFFERED', metadata: { metadataType: 0, title: media.title } },
        });
      } else if (m.namespace === NS.receiver && (data.type === 'LAUNCH_ERROR' || data.type === 'INVALID_REQUEST') && data.requestId === launchId) {
        settle(new Error('le récepteur média ne démarre pas'));
      } else if (m.namespace === NS.media && loadId > 0) {
        if (data.type === 'MEDIA_STATUS') {
          // Statuts diffusés à tous (requestId 0) ou réponse au chargement : le dernier média est le nôtre.
          for (const status of (data.status as MediaStatus[] | undefined) ?? []) onMediaStatus(status);
        } else if (data.requestId === loadId && (data.type === 'LOAD_FAILED' || data.type === 'LOAD_CANCELLED' || data.type === 'INVALID_REQUEST')) {
          settle(new Error('l’appareil ne sait pas lire ce message'));
        }
      }
    });

    socket.on('data', (chunk: Buffer) => {
      try {
        framer(chunk);
      } catch (err) {
        settle(err as Error);
      }
    });
    socket.on('error', (err: NodeJS.ErrnoException) => settle(new Error(err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' || err.code === 'ETIMEDOUT' ? 'appareil injoignable' : `connexion impossible (${err.code ?? err.message})`)));
    socket.on('close', () => {
      settle(new Error('connexion fermée par l’appareil'));
      hangUp();
    });

    const start = () => {
      send('receiver-0', NS.connection, { type: 'CONNECT' });
      launchId = requestId++;
      send('receiver-0', NS.receiver, { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER, requestId: launchId });
    };
    // TLS : attendre la poignée de main ; connexion de test en clair : tout de suite.
    if ('encrypted' in socket) socket.once('secureConnect', start);
    else socket.once('connect', start);
  });
}
