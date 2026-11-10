import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { createConfigStore } from './config-store.ts';
import { createDevicesApi } from './devices-api.ts';
import { createFacesApi } from './faces-api.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createListsApi } from './lists-api.ts';
import { createPinGate } from './pin-gate.ts';
import { createFaceRecognition } from './services/faces.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions, createFaceStore } from './sources/faces.ts';
import { createListsStore } from './sources/lists.ts';
import { createNotesStore } from './sources/notes.ts';
import { createPinStore, MAX_PIN_FAILURES, PARENT_PIN_ID } from './sources/pins.ts';
import { connectedFrom, fixedClock } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const KEY = 'cle-de-test-de-la-tablette';

type CallOptions = { from?: string; token?: string; key?: string; actor?: string; body?: unknown };

/** Empreinte de visage de test : 64 valeurs égales. */
const face = (value: number) => Array.from({ length: 64 }, () => value);

function setup() {
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
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
  const faces = createFaceStore({ path: join(dir, 'faces.json') });
  const sessions = createActorSessions(fixedClock);
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(KEY), actorOf: (t) => sessions.get(t, 10) });
  const household = createHousehold(config);
  const gate = createPinGate(pins);
  const recognition = createFaceRecognition({ faces, sessions, household, rules: () => config.current().faces, clock: fixedClock, logger: { info() {} } });
  const api = createRouter();
  api.route('/', createListsApi({ household, lists, notes, access }));
  api.route('/', createDevicesApi({ household, devices, pins: gate, access }));
  api.route('/', createFacesApi({ household, faces, recognition, sessions, pins: gate, access }));
  /** Session de la personne reconnue devant la tablette. */
  const as = (ownerId: string) => sessions.open(ownerId, 10).token;
  const parent = as('alex');
  const call = (method: string, path: string, { from = OTHER, token, key, actor, body }: CallOptions = {}) =>
    api.request(
      path,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(key && { 'X-Kiosk-Key': key }),
          ...(actor && { 'X-Actor-Session': actor }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      connectedFrom(from),
    );
  return { call, pins, as, parent };
}

describe('API des listes', () => {
  it('la tablette écrit pour la personne reconnue ; les autres appareils lisent seulement', async () => {
    const { call, as } = setup();
    const anonymous = await call('POST', '/lists/shopping', { from: TABLET, body: { label: 'Lait' } });
    expect(anonymous.status).toBe(403);
    expect(await anonymous.json()).toMatchObject({ identify: true });

    const res = await call('POST', '/lists/shopping', { from: TABLET, actor: as('alex'), body: { label: 'Lait' } });
    expect(res.status).toBe(201);
    expect((await res.json()).addedBy).toEqual({ ownerId: 'alex', via: 'tablet' });

    expect((await call('POST', '/lists/shopping', { body: { label: 'Pain' } })).status).toBe(403);
    // Une session ne vaut que sur la tablette.
    expect((await call('POST', '/lists/shopping', { actor: as('alex'), body: { label: 'Pain' } })).status).toBe(403);
    expect((await call('POST', '/lists/shopping', { from: TABLET, actor: 'inventee', body: { label: 'Pain' } })).status).toBe(403);
    expect((await call('GET', '/lists')).status).toBe(200);
    expect((await call('POST', '/lists/shopping', { from: TABLET, actor: as('alex'), body: { label: '' } })).status).toBe(400);
  });

  it('droits : un parent écrit partout, un enfant sur son profil seulement', async () => {
    const { call, as } = setup();
    const tom = as('tom');
    const alex = as('alex');
    const add = (ownerId: string, actor: string) => call('POST', '/lists/tasks', { from: TABLET, actor, body: { label: 'A', ownerId } });

    expect((await add('tom', tom)).status).toBe(201);
    const denied = await add('alex', tom);
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe('Lecture seule : profil de Alex');
    expect((await add('famille', tom)).status).toBe(403);
    expect((await call('POST', '/lists/shopping', { from: TABLET, actor: tom, body: { label: 'Bonbons' } })).status).toBe(403);

    const { id } = await (await add('tom', alex)).json();
    const { id: alexTask } = await (await add('alex', alex)).json();
    expect((await call('PUT', `/lists/tasks/${id}`, { from: TABLET, actor: tom, body: { done: true } })).status).toBe(200);
    expect((await call('PUT', `/lists/tasks/${alexTask}`, { from: TABLET, actor: tom, body: { done: true } })).status).toBe(403);
    expect((await call('DELETE', `/lists/tasks/${alexTask}`, { from: TABLET, actor: tom })).status).toBe(403);
    expect((await call('DELETE', `/lists/tasks/${alexTask}`, { from: TABLET, actor: alex })).status).toBe(204);
    expect((await call('PUT', '/lists/tasks/inconnue', { from: TABLET, actor: alex, body: { done: true } })).status).toBe(404);
  });

  it('appairage : code créé par la tablette seule, téléphone lié au profil du code', async () => {
    const { call, as, parent } = setup();
    expect((await call('POST', '/pairing', { body: { ownerId: 'tom' } })).status).toBe(403);
    const { code } = await (await call('POST', '/pairing', { from: TABLET, actor: parent, body: { ownerId: 'tom' } })).json();

    const claimed = await call('POST', '/pairing/claim', { body: { code, name: 'Pixel 8' } });
    expect(claimed.status).toBe(201);
    const { token } = await claimed.json();
    expect((await call('POST', '/pairing/claim', { body: { code, name: 'Autre' } })).status).toBe(410);

    const me = await (await call('GET', '/me', { token })).json();
    expect(me).toMatchObject({ kiosk: false, device: { ownerId: 'tom', name: 'Pixel 8' } });

    // Le téléphone écrit au nom de Tom, sur son profil seulement (Tom n'est pas parent).
    const task = await call('POST', '/lists/tasks', { token, body: { label: 'Dentiste', ownerId: 'tom' } });
    expect(task.status).toBe(201);
    expect((await task.json()).addedBy).toEqual({ ownerId: 'tom', via: 'phone' });
    expect((await call('POST', '/lists/tasks', { token, body: { label: 'Dentiste', ownerId: 'alex' } })).status).toBe(403);

    // Relier un téléphone : il faut pouvoir écrire sur ce profil.
    expect((await call('POST', '/pairing', { from: TABLET, body: { ownerId: 'tom' } })).status).toBe(403);
    expect((await call('POST', '/pairing', { from: TABLET, actor: as('tom'), body: { ownerId: 'alex' } })).status).toBe(403);

    // Le téléphone ne gère pas les autres téléphones.
    expect((await call('GET', '/devices', { token })).status).toBe(403);
    const [device] = await (await call('GET', '/devices', { from: TABLET })).json();
    expect((await call('DELETE', `/devices/${device.id}`, { from: TABLET, actor: parent })).status).toBe(204);

    // Retiré : 401, pour que le téléphone propose de se réappairer.
    expect((await call('POST', '/lists/shopping', { token, body: { label: 'Lait' } })).status).toBe(401);
    expect((await call('GET', '/me', { token })).status).toBe(401);
  });

  it('tâches : profil, échéance et répétition validés', async () => {
    const { call, as } = setup();
    const actor = as('alex');
    const add = (body: unknown) => call('POST', '/lists/tasks', { from: TABLET, actor, body });
    expect((await add({ label: 'A', ownerId: 'inconnu' })).status).toBe(400);
    expect((await add({ label: 'A', ownerId: 'tom', due: 'demain' })).status).toBe(400);
    const res = await add({ label: 'Poubelles', ownerId: 'famille', due: '2026-11-03', repeat: { every: 1, unit: 'week' } });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect((await call('PUT', `/lists/tasks/${id}`, { from: TABLET, actor, body: { done: true } })).status).toBe(200);
    expect((await call('DELETE', `/lists/tasks/${id}`, { from: TABLET, actor })).status).toBe(204);
  });

  it('clé de la tablette : reconnue d’où qu’elle vienne ; une mauvaise clé ne donne rien', async () => {
    const { call, as } = setup();
    expect((await (await call('GET', '/me', { key: KEY })).json()).kiosk).toBe(true);
    expect((await call('POST', '/lists/shopping', { key: KEY, actor: as('alex'), body: { label: 'Lait' } })).status).toBe(201);
    expect((await (await call('GET', '/me', { key: 'mauvaise-cle-de-la-tablette' })).json()).kiosk).toBe(false);
    expect((await call('POST', '/pairing', { key: 'x', body: { ownerId: 'tom' } })).status).toBe(403);
  });

  it('PIN : demandé pour un profil protégé, bloqué après trop d’erreurs', async () => {
    const { call, pins, parent } = setup();
    await pins.set('alex', '4821');
    const pair = (pin?: string) => call('POST', '/pairing', { key: KEY, actor: parent, body: { ownerId: 'alex', pin } });

    expect(await (await call('GET', '/pairing/pins', { key: KEY })).json()).toEqual({ protected: ['alex'], parent: false });
    expect((await call('GET', '/pairing/pins')).status).toBe(403);
    expect((await call('POST', '/pairing', { key: KEY, actor: parent, body: { ownerId: 'tom' } })).status).toBe(201);
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
    const { call, pins, parent } = setup();
    const link = async (ownerId: string) => {
      const { code } = await (await call('POST', '/pairing', { key: KEY, actor: parent, body: { ownerId } })).json();
      return (await (await call('POST', '/pairing/claim', { body: { code, name: 'Pixel' } })).json()).device.id as string;
    };
    const remove = (id: string, pin?: string) => call('DELETE', `/devices/${id}`, { key: KEY, actor: parent, body: pin ? { pin } : undefined });

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

  it('mots : envoyés depuis un profil, à un autre ; vus par leur destinataire', async () => {
    const { call, as, parent } = setup();
    const { code } = await (await call('POST', '/pairing', { key: KEY, actor: parent, body: { ownerId: 'tom' } })).json();
    const { token } = await (await call('POST', '/pairing/claim', { body: { code, name: 'Pixel' } })).json();
    const alex = as('alex');
    const tom = as('tom');
    const send = (body: unknown, actor = alex) => call('POST', '/notes', { key: KEY, actor, body });

    expect((await call('POST', '/notes', { body: { to: 'alex', from: 'tom', text: 'Coucou' } })).status).toBe(403);
    expect((await send({ to: 'tom', text: 'Coucou' })).status).toBe(400); // depuis quel profil ?
    expect((await send({ to: 'inconnu', from: 'alex', text: 'Coucou' })).status).toBe(400);
    expect((await send({ to: 'alex', from: 'alex', text: 'Coucou' })).status).toBe(400); // pas à soi-même
    expect((await send({ to: 'tom', from: 'alex', text: 'x'.repeat(201) })).status).toBe(400);
    expect((await send({ to: 'alex', from: 'famille', text: 'Coucou' }, tom)).status).toBe(403); // Tom, enfant

    const fromTablet = await (await send({ to: 'tom', from: 'alex', text: 'Range ta chambre' })).json();
    expect(fromTablet.from).toEqual({ ownerId: 'alex', via: 'tablet' });
    // Un parent envoie aussi depuis le profil de la famille.
    expect((await (await send({ to: 'tom', from: 'famille', text: 'Repas à 19 h' })).json()).from.ownerId).toBe('famille');
    // Le téléphone envoie depuis son profil, quoi qu'il annonce.
    const fromPhone = await (await call('POST', '/notes', { token, body: { to: 'alex', from: 'alex', text: 'Je rentre à 18 h' } })).json();
    expect(fromPhone.from).toEqual({ ownerId: 'tom', via: 'phone' });
    expect((await call('POST', '/notes', { token, body: { to: 'tom', text: 'Moi' } })).status).toBe(400);

    expect((await call('PUT', `/notes/${fromPhone.id}/seen`, { token })).status).toBe(403); // pour Alex, pas Tom
    expect((await call('PUT', `/notes/${fromPhone.id}/seen`, { key: KEY, actor: tom })).status).toBe(403);
    expect((await call('PUT', `/notes/${fromTablet.id}/seen`, { token })).status).toBe(200);
    expect((await call('PUT', `/notes/${fromPhone.id}/seen`, { key: KEY, actor: alex })).status).toBe(200);
    const family = await (await send({ to: 'famille', from: 'alex', text: 'Bonne journée' })).json();
    expect((await call('PUT', `/notes/${family.id}/seen`, { token })).status).toBe(403); // à toute la famille : un parent
    expect((await call('PUT', `/notes/${family.id}/seen`, { key: KEY, actor: alex })).status).toBe(200);
    expect((await call('PUT', '/notes/inconnu/seen', { key: KEY, actor: alex })).status).toBe(404);
    const all = await (await call('GET', '/notes')).json();
    expect(all.filter((n: { seenAt?: string }) => !n.seenAt)).toHaveLength(1); // « Repas à 19 h », pas encore vu
  });

  it('visages : enregistrés avec le code parent, reconnus avec une marge sur la personne suivante', async () => {
    const { call, pins } = setup();
    const enroll = (ownerId: string, value: number, pin?: string) =>
      call('POST', `/faces/${ownerId}`, { key: KEY, body: { embeddings: [face(value)], pin } });
    const identify = (value: number, real = 0.9, live = 0.9) =>
      call('POST', '/faces/identify', { key: KEY, body: { embedding: face(value), real, live } });

    expect((await enroll('alex', 1)).status).toBe(403); // pas encore de code parent
    await pins.set(PARENT_PIN_ID, '9753');
    expect((await enroll('alex', 1)).status).toBe(403);
    expect((await enroll('alex', 1, '0000')).status).toBe(403);
    expect((await call('POST', '/faces/alex', { body: { embeddings: [face(1)], pin: '9753' } })).status).toBe(403); // pas la tablette
    expect((await enroll('inconnu', 1, '9753')).status).toBe(400);
    expect((await enroll('alex', 1, '9753')).status).toBe(204);
    expect((await enroll('tom', -1, '9753')).status).toBe(204);
    expect(await (await call('GET', '/faces', { key: KEY })).json()).toEqual({
      enrolled: ['alex', 'tom'],
      samples: { alex: { enrolled: 1, learned: 0 }, tom: { enrolled: 1, learned: 0 } },
    });

    const found = await identify(0.98);
    expect(found.status).toBe(200);
    const { ownerId, token } = await found.json();
    expect(ownerId).toBe('alex');
    expect((await call('POST', '/lists/shopping', { key: KEY, actor: token, body: { label: 'Lait' } })).status).toBe(201);

    expect((await identify(0)).status).toBe(401); // à égale distance des deux : trop incertain
    expect((await identify(1, 0.1)).status).toBe(401); // photo
    expect((await identify(1, 0.9, 0.1)).status).toBe(401); // écran
    expect((await call('POST', '/faces/identify', { body: { embedding: face(1), real: 1, live: 1 } })).status).toBe(403);

    // Diagnostic : verdict et ressemblances, sans session ni apprentissage.
    const diagnose = await call('POST', '/faces/diagnose', { key: KEY, body: { embedding: face(0), real: 0.9, live: 0.9 } });
    expect(await diagnose.json()).toMatchObject({
      verdict: { result: 'close' },
      scores: [{ score: 0.67 }, { score: 0.67 }],
      rules: { threshold: 0.55, margin: 0.05 },
    });
    expect((await call('POST', '/faces/diagnose', { body: { embedding: face(1), real: 1, live: 1 } })).status).toBe(403);

    expect((await call('DELETE', '/faces/session', { key: KEY, actor: token })).status).toBe(204);
    expect((await call('POST', '/lists/shopping', { key: KEY, actor: token, body: { label: 'Pain' } })).status).toBe(403);

    expect((await call('DELETE', '/faces/tom', { key: KEY })).status).toBe(403);
    expect((await call('DELETE', '/faces/tom', { key: KEY, body: { pin: '9753' } })).status).toBe(204);
    expect((await call('DELETE', '/faces/tom', { key: KEY, body: { pin: '9753' } })).status).toBe(404);
  });

  it('visages : une reconnaissance sûre et nouvelle apprend une empreinte, au plus une par période', async () => {
    const { call, pins } = setup();
    await pins.set(PARENT_PIN_ID, '9753');
    await call('POST', '/faces/alex', { key: KEY, body: { embeddings: [face(1)], pin: '9753' } });
    await call('POST', '/faces/tom', { key: KEY, body: { embeddings: [face(-1)], pin: '9753' } });
    const identify = (value: number) =>
      call('POST', '/faces/identify', { key: KEY, body: { embedding: face(value), real: 0.9, live: 0.9 } });
    const learned = async () => (await (await call('GET', '/faces', { key: KEY })).json()).samples.alex.learned;

    expect((await identify(0.98)).status).toBe(200); // ressemblance 1 : rien de nouveau
    expect(await learned()).toBe(0);
    expect((await identify(0.2)).status).toBe(200); // sûre, et différente des empreintes connues
    expect(await learned()).toBe(1);
    // Tout aussi sûre et nouvelle (même par rapport à celle apprise), mais une seule par période.
    const other = Array.from({ length: 64 }, (_, i) => (i % 2 ? 1.8 : 0.2));
    const again = await call('POST', '/faces/identify', { key: KEY, body: { embedding: other, real: 0.9, live: 0.9 } });
    expect(again.status).toBe(200);
    expect(await learned()).toBe(1);
  });

  it('renommer un téléphone : tablette seulement, nom non vide', async () => {
    const { call, parent } = setup();
    const { code } = await (await call('POST', '/pairing', { key: KEY, actor: parent, body: { ownerId: 'tom' } })).json();
    const claimed = await call('POST', '/pairing/claim', { body: { code, name: 'SM-A556B', system: 'Android 15' } });
    const { device } = await claimed.json();
    expect(device).toMatchObject({ name: 'SM-A556B', system: 'Android 15' });
    const rename = (name: unknown, key?: string) => call('PATCH', `/devices/${device.id}`, { key, actor: parent, body: { name } });
    expect((await rename('Galaxy de Tom')).status).toBe(403);
    expect((await rename('  ', KEY)).status).toBe(400);
    expect(await (await rename(' Galaxy de Tom ', KEY)).json()).toMatchObject({ name: 'Galaxy de Tom' });
    expect((await call('PATCH', '/devices/inconnu', { key: KEY, actor: parent, body: { name: 'X' } })).status).toBe(404);
  });
});
