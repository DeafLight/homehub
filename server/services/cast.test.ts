// Tests du client Cast v2 : encodage et décodage des messages, découpage du flux, et lecture complète contre le faux
// appareil (vraie connexion TLS locale) : lecture démarrée sans jamais envoyer CLOSE (qui arrête le vrai récepteur par
// défaut : bip, puis rien), média refusé ou illisible, appareil injoignable, appareil muet.
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { castFramer, castPlay, type CastMessage, decodeCastMessage, encodeCastMessage } from './cast.ts';
import { type FakeCastDevice, startFakeCastDevice } from './cast-fake.ts';

const message: CastMessage = { source: 'sender-0', destination: 'receiver-0', namespace: 'urn:x-cast:com.google.cast.tp.connection', payload: JSON.stringify({ type: 'CONNECT', texte: 'éà' }) };
const media = { url: 'http://192.168.1.10:3010/api/cast/clips/abc.webm', contentType: 'audio/webm', title: 'Message de Alex' };

describe('messages Cast', () => {
  it('aller-retour encodage, décodage (longueur en tête, texte UTF-8)', () => {
    const frame = encodeCastMessage(message);
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
    expect(decodeCastMessage(frame.subarray(4))).toEqual(message);
  });

  it('un long message (longueurs sur plusieurs octets)', () => {
    const long = { ...message, payload: 'x'.repeat(70_000) };
    expect(decodeCastMessage(encodeCastMessage(long).subarray(4))).toEqual(long);
  });

  it('flux découpé n’importe où, ou plusieurs messages d’un coup', () => {
    const got: CastMessage[] = [];
    const feed = castFramer((m) => got.push(m));
    const both = Buffer.concat([encodeCastMessage(message), encodeCastMessage({ ...message, source: 'autre' })]);
    for (let i = 0; i < both.length; i += 7) feed(both.subarray(i, i + 7));
    expect(got.map((m) => m.source)).toEqual(['sender-0', 'autre']);
  });

  it('données mal formées : erreur', () => {
    expect(() => decodeCastMessage(Buffer.from([0x12, 0x40, 0x41]))).toThrow('mal formé');
  });
});

describe('lecture sur un appareil', () => {
  let device: FakeCastDevice | null = null;
  afterEach(async () => {
    await device?.close();
    device = null;
  });

  it('lance le récepteur par défaut, charge le média et résout quand la lecture démarre', async () => {
    device = await startFakeCastDevice();
    await castPlay({ host: '127.0.0.1', port: device.port }, media);
    expect(device.plays).toEqual([media]);
  });

  it('n’envoie jamais CLOSE : le message est lu jusqu’au bout, puis on raccroche', async () => {
    device = await startFakeCastDevice({ playMs: 100 });
    await castPlay({ host: '127.0.0.1', port: device.port }, media);
    await new Promise((r) => setTimeout(r, 250));
    expect(device.closes).toBe(0);
    expect(device.plays).toHaveLength(1);
    // Message fini : le lecteur est fermé (la télé revient à ce qu'elle montrait).
    expect(device.stops).toBe(1);
  });

  it('étapes journalisées : connexion, lancement, chargement, lecture', async () => {
    device = await startFakeCastDevice();
    const steps: string[] = [];
    await castPlay({ host: '127.0.0.1', port: device.port }, media, { log: (s) => steps.push(s.replace(/ \(\d+ ms\)$/, '')) });
    expect(steps).toEqual(['connecté, lancement du lecteur Cast', 'lecteur Cast prêt, chargement du message', 'média : IDLE', 'média : BUFFERING', 'média : PLAYING']);
  });

  it('lecteur lancé mais lecture qui ne vient pas : délai de lecture, étape « play »', async () => {
    device = await startFakeCastDevice({ fetchMedia: true });
    const slow = { ...media, url: 'http://127.0.0.1:9/inaccessible.webm' };
    await expect(castPlay({ host: '127.0.0.1', port: device.port }, slow, { playTimeoutMs: 5000 })).rejects.toMatchObject({ stage: 'play' });
  });

  it('erreur de lecture sur l’appareil (format) : message clair', async () => {
    device = await startFakeCastDevice({ unplayable: true });
    await expect(castPlay({ host: '127.0.0.1', port: device.port }, media)).rejects.toThrow('ne sait pas lire');
  });

  it('média refusé par l’appareil : message clair', async () => {
    device = await startFakeCastDevice({ refuse: true });
    await expect(castPlay({ host: '127.0.0.1', port: device.port }, media)).rejects.toThrow('ne sait pas lire');
  });

  it('appareil injoignable', async () => {
    device = await startFakeCastDevice();
    const port = device.port;
    await device.close();
    device = null;
    await expect(castPlay({ host: '127.0.0.1', port }, media)).rejects.toThrow('injoignable');
  });

  it('appareil qui ne répond pas : délai dépassé', async () => {
    const silent = createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    const port = (silent.address() as { port: number }).port;
    await expect(castPlay({ host: '127.0.0.1', port }, media, { launchTimeoutMs: 200 })).rejects.toMatchObject({ stage: 'connect', message: 'l’appareil ne répond pas' });
    silent.close();
  });
});
