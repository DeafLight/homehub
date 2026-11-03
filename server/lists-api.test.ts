import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createListsApi } from './lists-api.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createListsStore } from './sources/lists.ts';
import { fixedClock } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';

type CallOptions = { from?: string; token?: string; body?: unknown };

function setup() {
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def' },
        { id: 'tom', name: 'Tom', color: '#d96aa7' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-lists-api-'));
  const lists = createListsStore({ path: join(dir, 'lists.json'), clock: fixedClock });
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock: fixedClock });
  const api = createListsApi({ config, lists, devices });
  const call = (method: string, path: string, { from = OTHER, token, body }: CallOptions = {}) =>
    api.request(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Real-IP': from,
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { call };
}

describe('API des listes', () => {
  it('la tablette écrit, au nom du profil ouvert ; les autres appareils lisent seulement', async () => {
    const { call } = setup();
    const res = await call('POST', '/lists/shopping', { from: TABLET, body: { label: 'Lait', by: 'alex' } });
    expect(res.status).toBe(201);
    expect((await res.json()).addedBy).toEqual({ ownerId: 'alex', via: 'tablet' });

    expect((await call('POST', '/lists/shopping', { body: { label: 'Pain' } })).status).toBe(403);
    expect((await call('GET', '/lists')).status).toBe(200);
    expect((await call('POST', '/lists/shopping', { from: TABLET, body: { label: '' } })).status).toBe(400);
    expect((await call('POST', '/lists/shopping', { from: TABLET, body: { label: 'X', by: 'inconnu' } })).status).toBe(400);
  });

  it('appairage : code créé par la tablette seule, téléphone lié au profil du code', async () => {
    const { call } = setup();
    expect((await call('POST', '/pairing', { body: { ownerId: 'tom' } })).status).toBe(403);
    const { code } = await (await call('POST', '/pairing', { from: TABLET, body: { ownerId: 'tom' } })).json();

    const claimed = await call('POST', '/pairing/claim', { body: { code, name: 'Pixel 8' } });
    expect(claimed.status).toBe(201);
    const { token } = await claimed.json();
    expect((await call('POST', '/pairing/claim', { body: { code, name: 'Autre' } })).status).toBe(410);

    const me = await (await call('GET', '/me', { token })).json();
    expect(me).toMatchObject({ kiosk: false, device: { ownerId: 'tom', name: 'Pixel 8' } });

    // Le téléphone écrit au nom de Tom, même s'il prétend être Alex.
    const task = await call('POST', '/lists/tasks', { token, body: { label: 'Dentiste', ownerId: 'alex', by: 'alex' } });
    expect(task.status).toBe(201);
    expect((await task.json()).addedBy).toEqual({ ownerId: 'tom', via: 'phone' });

    // Le téléphone ne gère pas les autres téléphones.
    expect((await call('GET', '/devices', { token })).status).toBe(403);
    const [device] = await (await call('GET', '/devices', { from: TABLET })).json();
    expect((await call('DELETE', `/devices/${device.id}`, { from: TABLET })).status).toBe(204);

    // Retiré : 401, pour que le téléphone propose de se réappairer.
    expect((await call('POST', '/lists/shopping', { token, body: { label: 'Lait' } })).status).toBe(401);
    expect((await call('GET', '/me', { token })).status).toBe(401);
  });

  it('tâches : profil, échéance et répétition validés', async () => {
    const { call } = setup();
    const add = (body: unknown) => call('POST', '/lists/tasks', { from: TABLET, body });
    expect((await add({ label: 'A', ownerId: 'inconnu' })).status).toBe(400);
    expect((await add({ label: 'A', ownerId: 'tom', due: 'demain' })).status).toBe(400);
    const res = await add({ label: 'Poubelles', ownerId: 'famille', due: '2026-11-03', repeat: { every: 1, unit: 'week' } });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect((await call('PUT', `/lists/tasks/${id}`, { from: TABLET, body: { done: true } })).status).toBe(200);
    expect((await call('DELETE', `/lists/tasks/${id}`, { from: TABLET })).status).toBe(204);
  });
});
