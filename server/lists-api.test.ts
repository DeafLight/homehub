import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createListsApi } from './lists-api.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createListsStore } from './sources/lists.ts';
import { createNotesStore } from './sources/notes.ts';
import { createPinStore, MAX_PIN_FAILURES, PARENT_PIN_ID } from './sources/pins.ts';
import { fixedClock } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const KEY = 'cle-de-test-de-la-tablette';

type CallOptions = { from?: string; token?: string; key?: string; body?: unknown };

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
  const pins = createPinStore({ path: join(dir, 'pins.json'), clock: fixedClock });
  const notes = createNotesStore({ path: join(dir, 'notes.json'), clock: fixedClock });
  const api = createListsApi({ config, lists, notes, devices, pins, kioskKey: KEY });
  const call = (method: string, path: string, { from = OTHER, token, key, body }: CallOptions = {}) =>
    api.request(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Real-IP': from,
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(key && { 'X-Kiosk-Key': key }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { call, pins };
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

  it('clé de la tablette : reconnue d’où qu’elle vienne ; une mauvaise clé ne donne rien', async () => {
    const { call } = setup();
    expect((await (await call('GET', '/me', { key: KEY })).json()).kiosk).toBe(true);
    expect((await call('POST', '/lists/shopping', { key: KEY, body: { label: 'Lait' } })).status).toBe(201);
    expect((await (await call('GET', '/me', { key: 'mauvaise-cle-de-la-tablette' })).json()).kiosk).toBe(false);
    expect((await call('POST', '/pairing', { key: 'x', body: { ownerId: 'tom' } })).status).toBe(403);
  });

  it('PIN : demandé pour un profil protégé, bloqué après trop d’erreurs', async () => {
    const { call, pins } = setup();
    await pins.set('alex', '4821');
    const pair = (pin?: string) => call('POST', '/pairing', { key: KEY, body: { ownerId: 'alex', pin } });

    expect(await (await call('GET', '/pairing/pins', { key: KEY })).json()).toEqual({ protected: ['alex'], parent: false });
    expect((await call('GET', '/pairing/pins')).status).toBe(403);
    expect((await call('POST', '/pairing', { key: KEY, body: { ownerId: 'tom' } })).status).toBe(201);
    expect((await pair()).status).toBe(403);
    expect((await pair('0000')).status).toBe(403);
    expect((await pair('4821')).status).toBe(201);

    for (let i = 0; i < MAX_PIN_FAILURES - 1; i++) expect((await pair('1111')).status).toBe(403);
    const locked = await pair('1111');
    expect(locked.status).toBe(429);
    expect((await locked.json()).error).toMatch(/15 min/);
    // Même le bon PIN est refusé pendant le blocage.
    expect((await pair('4821')).status).toBe(429);
  });

  it('retirer un téléphone : PIN du propriétaire ou code parent, quand l’un d’eux est défini', async () => {
    const { call, pins } = setup();
    const link = async (ownerId: string) => {
      const { code } = await (await call('POST', '/pairing', { key: KEY, body: { ownerId } })).json();
      return (await (await call('POST', '/pairing/claim', { body: { code, name: 'Pixel' } })).json()).device.id as string;
    };
    const remove = (id: string, pin?: string) => call('DELETE', `/devices/${id}`, { key: KEY, body: pin ? { pin } : undefined });

    // Aucun code défini : retrait direct (la tablette demande seulement de confirmer).
    expect((await remove(await link('tom'))).status).toBe(204);

    const alexPhone = await link('alex');
    const tomPhone = await link('tom');
    const otherPhone = await link('tom');
    await pins.set('alex', '4821');
    await pins.set(PARENT_PIN_ID, '9753');
    expect(await (await call('GET', '/pairing/pins', { key: KEY })).json()).toEqual({ protected: ['alex'], parent: true });

    expect((await remove(alexPhone)).status).toBe(403);
    expect((await remove(alexPhone, '1111')).status).toBe(403);
    expect((await remove(tomPhone, '4821')).status).toBe(403); // le PIN d'Alex ne retire pas le téléphone de Tom
    expect((await remove(alexPhone, '4821')).status).toBe(204);
    expect((await remove(tomPhone, '9753')).status).toBe(204); // le code parent retire tous les téléphones
    expect((await call('DELETE', `/devices/${otherPhone}`, { body: { pin: '9753' } })).status).toBe(403); // pas la tablette
    expect((await remove('inconnu', '9753')).status).toBe(404);
  });

  it('mots : signés par le téléphone ou le profil choisi sur la tablette ; vus par leur destinataire', async () => {
    const { call } = setup();
    const { code } = await (await call('POST', '/pairing', { key: KEY, body: { ownerId: 'tom' } })).json();
    const { token } = await (await call('POST', '/pairing/claim', { body: { code, name: 'Pixel' } })).json();

    expect((await call('POST', '/notes', { body: { to: 'alex', text: 'Coucou' } })).status).toBe(403);
    expect((await call('POST', '/notes', { key: KEY, body: { to: 'alex', text: 'Coucou' } })).status).toBe(400); // qui écrit ?
    expect((await call('POST', '/notes', { key: KEY, body: { to: 'inconnu', text: 'Coucou', by: 'tom' } })).status).toBe(400);
    expect((await call('POST', '/notes', { key: KEY, body: { to: 'alex', text: 'x'.repeat(201), by: 'tom' } })).status).toBe(400);

    const fromTablet = await (await call('POST', '/notes', { key: KEY, body: { to: 'tom', text: 'Range ta chambre', by: 'alex' } })).json();
    expect(fromTablet.from).toEqual({ ownerId: 'alex', via: 'tablet' });
    // Le téléphone signe de son profil, quoi qu'il annonce.
    const fromPhone = await (await call('POST', '/notes', { token, body: { to: 'alex', text: 'Je rentre à 18 h', by: 'alex' } })).json();
    expect(fromPhone.from).toEqual({ ownerId: 'tom', via: 'phone' });

    expect((await call('PUT', `/notes/${fromPhone.id}/seen`, { token })).status).toBe(403); // pas pour Tom
    expect((await call('PUT', `/notes/${fromTablet.id}/seen`, { token })).status).toBe(200);
    expect((await call('PUT', `/notes/${fromPhone.id}/seen`, { key: KEY, body: { by: 'alex' } })).status).toBe(200);
    expect((await call('PUT', '/notes/inconnu/seen', { key: KEY })).status).toBe(404);
    const all = await (await call('GET', '/notes')).json();
    expect(all.every((n: { seenAt?: string }) => n.seenAt)).toBe(true);
  });

  it('renommer un téléphone : tablette seulement, nom non vide', async () => {
    const { call } = setup();
    const { code } = await (await call('POST', '/pairing', { key: KEY, body: { ownerId: 'tom' } })).json();
    const claimed = await call('POST', '/pairing/claim', { body: { code, name: 'SM-A556B', system: 'Android 15' } });
    const { device } = await claimed.json();
    expect(device).toMatchObject({ name: 'SM-A556B', system: 'Android 15' });
    const rename = (name: unknown, key?: string) => call('PATCH', `/devices/${device.id}`, { key, body: { name } });
    expect((await rename('Galaxy de Tom')).status).toBe(403);
    expect((await rename('  ', KEY)).status).toBe(400);
    expect(await (await rename(' Galaxy de Tom ', KEY)).json()).toMatchObject({ name: 'Galaxy de Tom' });
    expect((await call('PATCH', '/devices/inconnu', { key: KEY, body: { name: 'X' } })).status).toBe(404);
  });
});
