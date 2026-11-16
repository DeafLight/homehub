// Tests du Web Push maison : exemple de la RFC 8291 (annexe A), déchiffrement côté navigateur simulé, signature VAPID
// vérifiée avec la clé publique, et réponse du service de push (abonnement périmé).
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload, generateVapidKeys, isValidP256, sendPush, vapidAuthorization } from './web-push.ts';

const unb64 = (s: string) => Buffer.from(s, 'base64url');

/** Déchiffrement tel que le fait le navigateur (RFC 8291), écrit à part de l'implémentation. */
function decrypt(message: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const salt = message.subarray(0, 16);
  const idlen = message.readUInt8(20);
  const asPublic = message.subarray(21, 21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const body = message.subarray(21 + idlen);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  expect(plain.at(-1)).toBe(2); // dernier enregistrement
  return plain.subarray(0, -1).toString();
}

describe('chiffrement Web Push (RFC 8291)', () => {
  it("reproduit l'exemple de la RFC 8291", () => {
    const out = encryptPayload(
      Buffer.from('When I grow up, I want to be a watermelon'),
      {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      { salt: unb64('DGv6ra1nlYgDCS1FRnbzlw'), ephemeral: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' },
    );
    // En-tête : sel, taille d'enregistrement 4096, clé publique du serveur (as_public de la RFC).
    expect(out.subarray(0, 86).toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    );
    // Le corps se déchiffre avec la CEK et le nonce donnés par la RFC.
    const body = out.subarray(86);
    const decipher = createDecipheriv('aes-128-gcm', unb64('oIhVW04MRdy2XN9CiKLxTg'), unb64('4h_95klXJ5E_qnoN'));
    decipher.setAuthTag(body.subarray(body.length - 16));
    const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
    expect(plain.toString()).toBe('When I grow up, I want to be a watermelon\x02');
  });

  it('un navigateur abonné relit le message', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.from('0123456789abcdef');
    const out = encryptPayload(Buffer.from('{"title":"Pars dans 5 min"}'), { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') });
    expect(out.readUInt32BE(16)).toBe(4096);
    expect(decrypt(out, ua.getPrivateKey(), auth)).toBe('{"title":"Pars dans 5 min"}');
  });
});

describe('VAPID', () => {
  it('clés neuves valides et JWT signé pour l’origine du service', () => {
    const keys = generateVapidKeys();
    expect(isValidP256(keys.publicKey)).toBe(true);
    expect(isValidP256('AAAA')).toBe(false);
    const now = new Date('2026-11-05T07:00:00Z');
    const header = vapidAuthorization('https://push.exemple.test/abc/123', keys, 'mailto:homehub@exemple.test', now);
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/u.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(unb64(c).toString())).toEqual({ aud: 'https://push.exemple.test', exp: now.getTime() / 1000 + 43_200, sub: 'mailto:homehub@exemple.test' });
    const raw = unb64(keys.publicKey);
    const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, unb64(s))).toBe(true);
  });
});

describe('sendPush', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const subscription = { endpoint: 'https://push.exemple.test/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: 'AAAAAAAAAAAAAAAAAAAAAA' } };
  const keys = generateVapidKeys();
  const send = (status: number | Error) => {
    const calls: RequestInit[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      if (status instanceof Error) throw status;
      return new Response(null, { status });
    }) as unknown as typeof fetch;
    return { calls, result: sendPush(subscription, { title: 'Pars dans 5 min', body: 'Tram A à 7 h 29' }, { keys, subject: 'mailto:x@exemple.test', now: new Date(), fetchFn }) };
  };

  it('envoie le message chiffré avec les en-têtes du protocole', async () => {
    const { calls, result } = send(201);
    expect(await result).toBe('sent');
    const headers = calls[0].headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.TTL).toBe('600');
    expect(headers.Authorization).toMatch(/^vapid t=/u);
    expect(decrypt(Buffer.from(calls[0].body as Uint8Array), ua.getPrivateKey(), unb64(subscription.keys.auth))).toContain('Tram A');
  });

  it('abonnement périmé (404, 410) ou échec passager', async () => {
    expect(await send(410).result).toBe('gone');
    expect(await send(404).result).toBe('gone');
    expect(await send(500).result).toBe('failed');
    expect(await send(new Error('réseau')).result).toBe('failed');
  });
});
