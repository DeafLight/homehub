// Tests des droits : qui appelle (tablette, téléphone, autre appareil), et ce que chaque garde exige.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createRouter } from './http.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions } from './sources/faces.ts';
import { fixedClock } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';

async function setup() {
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
        { id: 'tom', name: 'Tom', color: '#d96aa7' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const devices = createDeviceStore({ path: join(mkdtempSync(join(tmpdir(), 'homehub-access-')), 'devices.json'), clock: fixedClock });
  const sessions = createActorSessions(fixedClock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: (t) => sessions.get(t, 10) });
  const phoneOf = async (ownerId: string) => (await devices.claim(devices.createCode(ownerId).code, 'Téléphone'))!.token;
  const tomPhone = await phoneOf('tom');

  const app = createRouter();
  app.get('/writer/:target', async (c) => c.json(await access.writer(c, c.req.param('target') === 'rien' ? null : c.req.param('target'))));
  app.get('/parent', async (c) => c.json(await access.parent(c, 'Seul un parent')));
  app.get('/kiosk', async (c) => c.json((await access.kiosk(c)).kiosk));
  app.get('/trusted', async (c) => c.json((await access.trusted(c)).kiosk));
  app.get('/appliance', async (c) => c.json(await access.appliance(c)));

  type From = { address?: string; token?: string; actor?: string };
  const call = async (path: string, { address = OTHER, token, actor }: From = {}) => {
    const headers: Record<string, string> = { 'X-Real-IP': address };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (actor) headers['X-Actor-Session'] = actor;
    const res = await app.request(path, { headers });
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
