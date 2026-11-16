// Web Push sans dépendance (notification « Pars dans 5 min ») : chiffrement du message pour le navigateur (RFC 8291,
// aes128gcm, RFC 8188) et signature VAPID (RFC 8292, JWT ES256), tout par `node:crypto`. Le service de push du
// navigateur (Google, Apple, Mozilla) ne voit que du chiffré ; il reçoit l'adresse de l'abonnement et la clé publique
// du serveur. Les clés VAPID sont générées une fois et gardées dans le dossier d'état (sources/push.ts), jamais dans
// le dépôt.
import { createECDH, createCipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/** Clés VAPID du serveur : publique en point non compressé (65 octets) et privée (32 octets), en base64url. */
export type VapidKeys = { publicKey: string; privateKey: string };
/** Abonnement d'un navigateur (PushSubscription.toJSON()). */
export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };

const b64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

/** Nouvelle paire de clés VAPID (P-256). */
export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  return { publicKey: b64(Buffer.concat([Buffer.from([4]), unb64(pub.x!), unb64(pub.y!)])), privateKey: priv.d! };
}

/** Clé privée VAPID en objet de clé (JWK reconstruit à partir des deux moitiés). */
function vapidPrivateKey({ publicKey, privateKey }: VapidKeys): KeyObject {
  const raw = unb64(publicKey);
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64(raw.subarray(1, 33)), y: b64(raw.subarray(33, 65)), d: privateKey }, format: 'jwk' });
}

/** Vérifie qu'une clé publique est un point P-256 non compressé valide (65 octets). */
export function isValidP256(publicKey: string): boolean {
  const raw = unb64(publicKey);
  if (raw.length !== 65 || raw[0] !== 4) return false;
  try {
    createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64(raw.subarray(1, 33)), y: b64(raw.subarray(33, 65)) }, format: 'jwk' });
    return true;
  } catch {
    return false;
  }
}

/** En-tête Authorization VAPID pour `endpoint` : JWT ES256 (aud : l'origine du service, exp : 12 h), et clé publique. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now: Date): string {
  const header = b64(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: subject };
  const unsigned = `${header}.${b64(Buffer.from(JSON.stringify(claims)))}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: vapidPrivateKey(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64(signature)}, k=${keys.publicKey}`;
}

const RECORD_SIZE = 4096;

/**
 * Message chiffré pour un abonnement (RFC 8291) : en-tête aes128gcm (sel, taille d'enregistrement, clé publique
 * éphémère) puis un seul enregistrement. `salt` et `ephemeral` (clé privée éphémère, base64url) ne servent qu'aux tests.
 */
export function encryptPayload(
  plaintext: Uint8Array,
  subscription: PushSubscriptionJson['keys'],
  { salt = randomBytes(16), ephemeral }: { salt?: Uint8Array; ephemeral?: string } = {},
): Buffer {
  const uaPublic = unb64(subscription.p256dh);
  const authSecret = unb64(subscription.auth);
  const ecdh = createECDH('prime256v1');
  if (ephemeral) ecdh.setPrivateKey(unb64(ephemeral));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  // IKM = HKDF(auth, ECDH, "WebPush: info" || 0 || ua_public || as_public)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // Dernier (et seul) enregistrement : délimiteur 0x02, sans remplissage.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** Résultat d'un envoi : remis au service, abonnement périmé (à oublier), ou échec passager. */
export type PushResult = 'sent' | 'gone' | 'failed';

export type PushMessage = { title: string; body: string; tag?: string; url?: string };

/** Envoie `message` (JSON chiffré) à un abonnement ; TTL court : une alerte de départ ne vaut que quelques minutes. */
export async function sendPush(
  subscription: PushSubscriptionJson,
  message: PushMessage,
  { keys, subject, now, ttlSeconds = 600, fetchFn = (...a) => fetch(...a) }: { keys: VapidKeys; subject: string; now: Date; ttlSeconds?: number; fetchFn?: typeof fetch },
): Promise<PushResult> {
  const body = encryptPayload(Buffer.from(JSON.stringify(message)), subscription.keys);
  try {
    const res = await fetchFn(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(subscription.endpoint, keys, subject, now),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttlSeconds),
        Urgency: 'high',
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
