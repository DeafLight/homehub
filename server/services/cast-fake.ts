// Faux appareil Google Cast, pour les tests et le monde fictif des captures : un serveur TLS local qui parle le même
// protocole Cast v2 qu'un Google Home ou une télé (connexion, lancement du récepteur par défaut, chargement d'un média)
// et garde la liste de ce qu'on lui a fait lire. Il peut aussi télécharger le média, comme le ferait l'appareil, pour
// vérifier que l'adresse donnée est bien servie. La clé et le certificat ci-dessous sont des données de test,
// publiques exprès, générées pour ce faux appareil seulement (un vrai appareil a son propre certificat auto-signé).
import { createServer, type Server, type TLSSocket } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { castFramer, type CastMessage, DEFAULT_MEDIA_RECEIVER, encodeCastMessage } from './cast.ts';

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgsTHwpW6BM1yFvxDd
Dmlq7dKu+72l3bHm58sgtTp6u9WhRANCAAQB6wgGUULQh1kpJs1RBtdSMa9TBAWL
fvdnU8BPLGh0/EngW4+9jWgYGDH+Z/a77wparoUk/7nIh3mblw/ZYU93
-----END PRIVATE KEY-----`;
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBlDCCATmgAwIBAgIUH0xqhk+bZgolaSaUaeCd8QbFiigwCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTZmF1eC1jYXN0LmxvY2FsaG9zdDAgFw0yNjExMTMyMTE3MDla
GA8yMTI2MTAyMDIxMTcwOVowHjEcMBoGA1UEAwwTZmF1eC1jYXN0LmxvY2FsaG9z
dDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABAHrCAZRQtCHWSkmzVEG11Ixr1ME
BYt+92dTwE8saHT8SeBbj72NaBgYMf5n9rvvClquhST/uciHeZuXD9lhT3ejUzBR
MB0GA1UdDgQWBBTOtvRHaq1yXvmTYjbzLGRuwHgXUzAfBgNVHSMEGDAWgBTOtvRH
aq1yXvmTYjbzLGRuwHgXUzAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kA
MEYCIQCJvR7fCdON0fUmfCKsApJ0cs3xC/tajZAa+QEvoeSBnwIhAMfi13TOXPq/
xefsU34AXxLJEse7Ald/9ZDoLJwK7SMe
-----END CERTIFICATE-----`;

/** Ce que le faux appareil a lu : adresse, type, titre, et la taille du fichier s'il l'a téléchargé. */
export type FakeCastPlay = { url: string; contentType: string; title: string; bytes?: number };

export type FakeCastDevice = {
  port: number;
  plays: FakeCastPlay[];
  /** Attend la prochaine lecture (ou la renvoie si elle a déjà eu lieu depuis le dernier appel). */
  nextPlay(): Promise<FakeCastPlay>;
  close(): Promise<void>;
};

/**
 * Démarre un faux appareil. `fetchMedia` : télécharger le média avant de répondre (et échouer si l'adresse ne
 * répond pas) ; `refuse` : refuser tout chargement (format non lu).
 */
export async function startFakeCastDevice({ port = 0, host = '127.0.0.1', fetchMedia = false, refuse = false }: { port?: number; host?: string; fetchMedia?: boolean; refuse?: boolean } = {}): Promise<FakeCastDevice> {
  const plays: FakeCastPlay[] = [];
  let seen = 0;
  const waiters: ((p: FakeCastPlay) => void)[] = [];
  const record = (p: FakeCastPlay) => {
    plays.push(p);
    const w = waiters.shift();
    if (w) {
      seen = plays.length;
      w(p);
    }
  };

  const server: Server = createServer({ key: TEST_KEY, cert: TEST_CERT }, (socket: TLSSocket) => {
    const transport = 'faux-recepteur-1';
    const reply = (to: CastMessage, from: string, namespace: string, payload: Record<string, unknown>) =>
      socket.write(encodeCastMessage({ source: from, destination: to.source, namespace, payload: JSON.stringify(payload) }));
    const framer = castFramer((m) => {
      const data = JSON.parse(m.payload) as Record<string, unknown>;
      if (data.type === 'LAUNCH' && data.appId === DEFAULT_MEDIA_RECEIVER) {
        reply(m, 'receiver-0', m.namespace, {
          type: 'RECEIVER_STATUS',
          requestId: data.requestId,
          status: { applications: [{ appId: DEFAULT_MEDIA_RECEIVER, displayName: 'Default Media Receiver', sessionId: 'faux', transportId: transport }], volume: { level: 0.5, muted: false } },
        });
      } else if (data.type === 'LOAD' && m.destination === transport) {
        const media = data.media as { contentId: string; contentType: string; metadata?: { title?: string } };
        void (async () => {
          const play: FakeCastPlay = { url: media.contentId, contentType: media.contentType, title: media.metadata?.title ?? '' };
          if (refuse) return reply(m, transport, m.namespace, { type: 'LOAD_FAILED', requestId: data.requestId });
          if (fetchMedia) {
            const res = await fetch(media.contentId).catch(() => null);
            if (!res?.ok) return reply(m, transport, m.namespace, { type: 'LOAD_FAILED', requestId: data.requestId });
            play.bytes = (await res.arrayBuffer()).byteLength;
          }
          record(play);
          reply(m, transport, m.namespace, { type: 'MEDIA_STATUS', requestId: data.requestId, status: [{ mediaSessionId: 1, playerState: 'PLAYING' }] });
        })();
      }
    });
    socket.on('data', (chunk: Buffer) => {
      try {
        framer(chunk);
      } catch {
        socket.destroy();
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));

  return {
    port: (server.address() as AddressInfo).port,
    plays,
    nextPlay: () =>
      new Promise((resolve) => {
        if (plays.length > seen) {
          seen = plays.length;
          resolve(plays[plays.length - 1]!);
        } else waiters.push(resolve);
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
