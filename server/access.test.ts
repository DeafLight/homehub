// Tests des droits : qui appelle (tablette, téléphone, autre appareil), et ce que chaque garde exige ; adresse du
// client, crue seulement venant d'un proxy de confiance.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addressMatcher, createAccess, kioskKeyMatcher, normalizeAddress } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createRouter } from './http.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { connectedFrom, fixedClock } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
/** Nginx Proxy Manager sur le réseau Docker `backend`. */
const PROXY = '172.20.0.5';
const KEY = 'cle-de-la-tablette-assez-longue';

async function setup() {
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'tom', name: 'Tom', color: '#d96aa7' },
      ],
      kiosk: { addresses: [TABLET] },
      trustedProxies: ['172.20.0.0/16'],
    }),
  );
  const devices = createDeviceStore({ path: join(mkdtempSync(join(tmpdir(), 'homehub-access-')), 'devices.json'), clock: fixedClock });
  const sessions = createActorSessions(fixedClock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(KEY), actorOf: (t) => sessions.get(t, 10) });
  const phoneOf = async (ownerId: string) => (await devices.claim(devices.createCode(ownerId).code, 'Téléphone'))!.token;
  const tomPhone = await phoneOf('tom');

  const app = createRouter();
  app.get('/writer/:target', async (c) => c.json(await access.writer(c, c.req.param('target') === 'rien' ? null : c.req.param('target'))));
  app.get('/parent', async (c) => c.json(await access.parent(c, 'Seul un parent')));
  app.get('/kiosk', async (c) => c.json((await access.kiosk(c)).kiosk));
  app.get('/trusted', async (c) => c.json((await access.trusted(c)).kiosk));
  app.get('/appliance', async (c) => c.json(await access.appliance(c)));

  /** `address` : adresse de la connexion ; `headers` : en-têtes en plus (X-Real-IP, X-Forwarded-For, clé). */
  type From = { address?: string; token?: string; actor?: string; headers?: Record<string, string> };
  const call = async (path: string, { address = OTHER, token, actor, headers: extra = {} }: From = {}) => {
    const headers: Record<string, string> = { ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (actor) headers['X-Actor-Session'] = actor;
    const res = await app.request(path, { headers }, connectedFrom(address));
    return { status: res.status, json: await res.json() };
  };
  const tablet = (ownerId?: string): From => ({ address: TABLET, ...(ownerId && { actor: sessions.open(ownerId, 10).token }) });
  return { call, tablet, tomPhone };
}

describe('droits', () => {
  it('writer : téléphone pour son profil, tablette pour la personne reconnue, enfant sur son profil seulement', async () => {
    const { call, tablet, tomPhone } = await setup();
    expect(await call('/writer/tom', { token: tomPhone })).toEqual({ status: 200, json: { ownerId: 'tom', via: 'phone' } });
    expect(await call('/writer/famille', { token: tomPhone })).toEqual({ status: 403, json: { error: 'Lecture seule : profil de Famille' } });
    expect(await call('/writer/tom', tablet('alex'))).toEqual({ status: 200, json: { ownerId: 'alex', via: 'tablet' } });
    expect(await call('/writer/rien', tablet())).toEqual({
      status: 403,
      json: { error: 'Qui es-tu ? Regarde la tablette pour être reconnu', identify: true },
    });
    expect(await call('/writer/rien')).toEqual({ status: 403, json: { error: 'Lecture seule : appareil non appairé' } });
    expect(await call('/writer/rien', { token: 'retire' })).toEqual({ status: 401, json: { error: 'Téléphone non reconnu : à appairer de nouveau' } });
  });

  it('parent : refuse un enfant avec le message de la route', async () => {
    const { call, tablet, tomPhone } = await setup();
    expect((await call('/parent', tablet('alex'))).status).toBe(200);
    expect(await call('/parent', { token: tomPhone })).toEqual({ status: 403, json: { error: 'Seul un parent' } });
  });

  it('kiosk et trusted : la tablette ; trusted accepte aussi un téléphone appairé', async () => {
    const { call, tablet, tomPhone } = await setup();
    expect((await call('/kiosk', tablet())).status).toBe(200);
    expect(await call('/kiosk', { token: tomPhone })).toEqual({ status: 403, json: { error: 'Réservé à la tablette de la maison' } });
    expect((await call('/trusted', { token: tomPhone })).status).toBe(200);
    expect(await call('/trusted')).toEqual({ status: 403, json: { error: 'Réservé à la tablette' } });
  });

  it('appliance : un appareil de la maison, sans exiger de visage', async () => {
    const { call, tablet, tomPhone } = await setup();
    expect((await call('/appliance', tablet())).json).toEqual({ ownerId: null, via: 'tablet' });
    expect((await call('/appliance', tablet('alex'))).json).toEqual({ ownerId: 'alex', via: 'tablet' });
    expect((await call('/appliance', { token: tomPhone })).json).toEqual({ ownerId: 'tom', via: 'phone' });
    expect((await call('/appliance')).status).toBe(403);
    expect((await call('/appliance', { token: 'retire' })).status).toBe(401);
  });
});

describe('adresse du client', () => {
  it('un en-tête X-Real-IP venant d’une connexion hors proxy ne compte pas', async () => {
    const { call } = await setup();
    for (const forged of ['127.0.0.1', '::1', TABLET]) {
      expect((await call('/kiosk', { headers: { 'X-Real-IP': forged } })).status).toBe(403);
      expect((await call('/kiosk', { headers: { 'X-Forwarded-For': forged } })).status).toBe(403);
    }
  });

  it('un proxy de confiance donne l’adresse du client', async () => {
    const { call } = await setup();
    expect((await call('/kiosk', { address: PROXY, headers: { 'X-Real-IP': TABLET } })).status).toBe(200);
    expect((await call('/kiosk', { address: PROXY, headers: { 'X-Real-IP': OTHER } })).status).toBe(403);
    // X-Forwarded-For : le client écrit ce qu'il veut à gauche, le proxy ajoute à droite l'adresse qu'il a vue.
    expect((await call('/kiosk', { address: PROXY, headers: { 'X-Forwarded-For': `${OTHER}, ${TABLET}` } })).status).toBe(200);
    expect((await call('/kiosk', { address: PROXY, headers: { 'X-Forwarded-For': `${TABLET}, ${OTHER}` } })).status).toBe(403);
    // Sans en-tête, la requête est celle du proxy lui-même : ni tablette, ni rien.
    expect((await call('/kiosk', { address: PROXY })).status).toBe(403);
  });

  it('même un proxy de confiance ne fait pas passer une adresse locale pour la tablette', async () => {
    const { call } = await setup();
    expect((await call('/kiosk', { address: PROXY, headers: { 'X-Real-IP': '127.0.0.1' } })).status).toBe(403);
    expect((await call('/kiosk', { address: PROXY, headers: { 'X-Forwarded-For': '::1' } })).status).toBe(403);
  });

  it('une connexion locale directe est la tablette (développement, santé du conteneur), pas une requête relayée', async () => {
    const { call } = await setup();
    expect((await call('/kiosk', { address: '127.0.0.1' })).status).toBe(200);
    expect((await call('/kiosk', { address: '::1' })).status).toBe(200);
    expect((await call('/kiosk', { address: '::ffff:127.0.0.1' })).status).toBe(200);
    // Un proxy installé sur la machine même relaie des clients du réseau : ce ne sont pas la tablette.
    expect((await call('/kiosk', { address: '127.0.0.1', headers: { 'X-Forwarded-For': OTHER } })).status).toBe(403);
  });

  it('la clé reconnaît la tablette, quelle que soit l’adresse (cas du déploiement réel, derrière le proxy)', async () => {
    const { call } = await setup();
    expect((await call('/kiosk', { address: PROXY, headers: { 'X-Real-IP': OTHER, 'X-Kiosk-Key': KEY } })).status).toBe(200);
    expect((await call('/kiosk', { headers: { 'X-Kiosk-Key': KEY } })).status).toBe(200);
    expect((await call('/kiosk', { headers: { 'X-Kiosk-Key': 'mauvaise-cle-de-la-tablette' } })).status).toBe(403);
  });

  it('addressMatcher : adresses et plages, IPv4 et IPv6 ; normalizeAddress : préfixe IPv4 dans IPv6, valeurs invalides', () => {
    const matches = addressMatcher(['172.20.0.0/16', '10.0.0.1', 'fd00::/8']);
    expect(['172.20.3.4', '10.0.0.1', 'fd12::1'].map(matches)).toEqual([true, true, true]);
    expect(['172.21.0.1', '10.0.0.2', '::1'].map(matches)).toEqual([false, false, false]);
    expect(addressMatcher([])('127.0.0.1')).toBe(false);
    expect(normalizeAddress('::ffff:192.168.1.5')).toBe('192.168.1.5');
    expect(normalizeAddress(' 192.168.1.5 ')).toBe('192.168.1.5');
    expect(normalizeAddress('pas une adresse')).toBeUndefined();
  });
});
