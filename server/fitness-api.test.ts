import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FitnessState } from '../shared/fitness.ts';
import type { TabletSession } from '../shared/fitness-workout.ts';
import { createAccess, kioskKeyMatcher } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createFitnessApi } from './fitness-api.ts';
import { createHousehold } from './household.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createFitnessStore } from './sources/fitness.ts';
import { NOW } from './testing.ts';

const TABLET = '192.168.1.50';

async function setup(actor: string | null = 'alex') {
  let now = new Date(NOW); // lundi 2 novembre 2026, 18:00
  const clock = () => new Date(now);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true, fitness: true },
        { id: 'sam', name: 'Sam', color: '#e8964a', parent: true },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-fitness-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const token = async (ownerId: string) => (await devices.claim(devices.createCode(ownerId).code, 'Téléphone'))!.token;
  const alex = await token('alex');
  const sam = await token('sam');
  const access = createAccess({ config, devices, isKey: kioskKeyMatcher(undefined), actorOf: () => actor });
  const path = join(dir, 'fitness.json');
  const fitness = createFitnessStore({ path, clock });
  const api = createFitnessApi({ fitness, household: createHousehold(config), access });
  const call = async <T = FitnessState>(method: string, url: string, body?: unknown, auth: string | null = alex, from = '192.168.1.20') => {
    const res = await api.request(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': from, ...(auth && { Authorization: `Bearer ${auth}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as T & { error?: string } };
  };
  const later = (days: number) => (now = new Date(now.getTime() + days * 86_400_000));
  return { call, sam, later, path, clock };
}

describe('API du programme de renforcement', () => {
  it('réservée au téléphone de la personne : ni la tablette, ni un autre membre, ni un profil sans programme', async () => {
    const { call, sam } = await setup();
    expect((await call('GET', '/fitness')).json).toMatchObject({ palier: 1, effort: 30, rest: 30, sessions: [] });
    expect((await call('GET', '/fitness', undefined, null)).status).toBe(403);
    expect((await call('GET', '/fitness', undefined, null, TABLET)).status).toBe(403);
    expect((await call('GET', '/fitness', undefined, sam)).status).toBe(404);
    expect((await call('GET', '/fitness', undefined, 'faux')).status).toBe(401);
  });

  it('enregistre une séance avec les exercices du programme, et le rythme du moment', async () => {
    const { call, path } = await setup();
    const res = await call('POST', '/fitness/sessions', {
      session: 1,
      rpe: 3,
      exercises: [{ family: 'poussee', rating: 'dur', pain: 'poignets', reps: 8, note: 'poignet droit' }],
    });
    expect(res.status).toBe(201);
    const [s] = res.json.sessions;
    expect(s).toMatchObject({ session: 1, palier: 1, effort: 30, rest: 30, rounds: 3, rpe: 3, stopped: false });
    expect(s.exercises).toHaveLength(6);
    expect(s.exercises.find((e) => e.family === 'poussee')).toEqual({
      family: 'poussee', exercise: 'pompes-mur', rating: 'dur', pain: 'poignets', reps: 8, note: 'poignet droit',
    });
    expect(JSON.parse(readFileSync(path, 'utf8')).members.alex.sessions).toHaveLength(1);
    expect((await call('POST', '/fitness/sessions', { session: 4, rpe: 3, exercises: [] })).status).toBe(400);
    expect((await call('DELETE', `/fitness/sessions/${s.id}`)).json.sessions).toEqual([]);
  });

  it('accepte une gêne : remplaçant doux à la séance suivante', async () => {
    const { call } = await setup();
    await call('POST', '/fitness/sessions', { session: 1, rpe: 2, exercises: [{ family: 'jambes', pain: 'genoux' }] });
    const res = await call('POST', '/fitness/slots', { session: 1, family: 'jambes', change: 'gentle' });
    expect(res.json.slots['1-jambes']).toMatchObject({ swap: 'pont-fessier' });
    expect((await call('POST', '/fitness/slots', { session: 1, family: 'poussee', change: 'easier' })).status).toBe(400);
  });

  it('bilan : choix du rythme proposé, une seule fois par semaine', async () => {
    const { call, later } = await setup();
    for (const session of [1, 2, 3]) {
      await call('POST', '/fitness/sessions', { session, rpe: 2, exercises: [] });
      later(1);
    }
    expect((await call('POST', '/fitness/rhythm', { week: '2026-11-02', option: 'down-same' })).status).toBe(400);
    const res = await call('POST', '/fitness/rhythm', { week: '2026-11-02', option: 'up-longer' });
    expect(res.json).toMatchObject({ palier: 1, effort: 35, rest: 30 });
    expect(res.json.reviews['2026-11-02']).toMatchObject({ choice: 'up-longer', from: { effort: 30, rest: 30 } });
    expect((await call('POST', '/fitness/rhythm', { week: '2026-11-02', option: 'keep' })).status).toBe(409);
  });

  it('cardio et tour de taille de la semaine (un lundi)', async () => {
    const { call, path, clock } = await setup();
    expect((await call('PUT', '/fitness/weeks/2026-11-02', { cardio: 90, waist: 92.5 })).json.weeks).toEqual({ '2026-11-02': { cardio: 90, waist: 92.5 } });
    expect((await call('PUT', '/fitness/weeks/2026-11-03', { cardio: 90, waist: null })).status).toBe(400);
    expect((await call('PUT', '/fitness/weeks/2026-11-02', { cardio: null, waist: null })).json.weeks).toEqual({});
    // Relu depuis le fichier au redémarrage.
    await call('PUT', '/fitness/weeks/2026-11-02', { cardio: 30, waist: null });
    const again = createFitnessStore({ path, clock });
    await again.load();
    expect(again.get('alex').weeks).toEqual({ '2026-11-02': { cardio: 30, waist: null } });
  });

  it('séance du jour sur la tablette : la personne reconnue seule, sans rien de personnel', async () => {
    const { call } = await setup();
    await call('PUT', '/fitness/weeks/2026-11-02', { cardio: 20, waist: 90 });
    const res = await call<TabletSession>('GET', '/fitness/tablet', undefined, null, TABLET);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      ownerId: 'alex', session: 1, palier: 1, rounds: 3, effort: 30, rest: 30,
      exercises: expect.arrayContaining([{ family: 'poussee', id: 'pompes-mur' }]),
    });
    expect(res.json.exercises).toHaveLength(6);
    expect(JSON.stringify(res.json)).not.toMatch(/waist|weeks|sessions|note/);
    // Pas depuis un téléphone, même celui de la personne.
    expect((await call('GET', '/fitness/tablet')).status).toBe(403);
  });

  it('sur la tablette : personne de reconnu, ou un profil sans programme, rien', async () => {
    const nobody = await setup(null);
    const res = await nobody.call('GET', '/fitness/tablet', undefined, null, TABLET);
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ identify: true });
    const sam = await setup('sam');
    expect((await sam.call('GET', '/fitness/tablet', undefined, null, TABLET)).status).toBe(404);
    expect((await sam.call('POST', '/fitness/tablet/sessions', { session: 1, rpe: 3 }, null, TABLET)).status).toBe(404);
  });

  it('fin de séance guidée : notée avec les exercices du programme, la séance suivante vient', async () => {
    const { call } = await setup();
    const res = await call<TabletSession>('POST', '/fitness/tablet/sessions', { session: 1, rpe: 4, stopped: true, note: 'ignorée' }, null, TABLET);
    expect(res.status).toBe(201);
    expect(res.json.session).toBe(2);
    const [s] = (await call('GET', '/fitness')).json.sessions;
    expect(s).toMatchObject({ session: 1, rpe: 4, stopped: true, note: null });
    expect(s.exercises).toHaveLength(6);
    expect((await call('POST', '/fitness/tablet/sessions', { session: 1, rpe: 9 }, null, TABLET)).status).toBe(400);
  });
});
