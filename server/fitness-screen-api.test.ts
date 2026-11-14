// Tests de la séance de sport sur la télé : seul le téléphone de la personne la lance et la pilote (ni la tablette, ni
// un autre membre, ni une télé, ni un profil sans programme) ; la télé ne reçoit que la séance en cours, sans rien de
// personnel ; pause, suivant, arrêter ; fin naturelle ; la télé efface tout à la fin et le téléphone garde la séance
// à noter ; télé occupée, absente, ou qui n'ouvre pas la page ; interrogation longue de la télé.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_PROTOCOL_HEADER, SCREEN_WORKOUT_PAGE, type ScreenEvent } from '../shared/screen.ts';
import type { PhoneScreenWorkout, ScreenWorkoutState, WorkoutScreen } from '../shared/screen-workout.ts';
import { createAccess, kioskKeyMatcher, OWN_PHONE_ONLY } from './access.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createFitnessScreenApi, NO_PROGRAM } from './fitness-screen-api.ts';
import { createHousehold } from './household.ts';
import { createRouter } from './http.ts';
import { createScreenHub, SCREEN_OFFLINE } from './services/screens.ts';
import { createScreenWorkouts, NO_SCREEN_WORKOUT, SCREEN_BUSY } from './services/screen-workouts.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createFitnessStore } from './sources/fitness.ts';
import { createScreenStore } from './sources/screens.ts';
import { connectedFrom, NOW } from './testing.ts';

const TABLET = '192.168.1.50';
const OTHER = '192.168.1.20';
const PROTOCOL = { [SCREEN_PROTOCOL_HEADER]: '1' };
/** Échauffement (5 × 60 s) + 3 tours de 6 efforts de 30 s, repos de 30 s, 60 s de plus entre les tours. */
const TOTAL_MS = (300 + 3 * 6 * 30 + (3 * 6 - 1) * 30 + 2 * 60) * 1000;

async function setup() {
  let now = NOW.getTime();
  const clock = () => new Date(now);
  const config = createConfigStore(
    parseConfig({
      members: [
        { id: 'alex', name: 'Alex', color: '#5b8def', parent: true, fitness: true },
        { id: 'sam', name: 'Sam', color: '#e8964a', parent: true, fitness: true },
        { id: 'lea', name: 'Léa', color: '#3fb8a8' },
      ],
      kiosk: { addresses: [TABLET] },
    }),
  );
  const dir = mkdtempSync(join(tmpdir(), 'homehub-fitness-screen-'));
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock });
  const screens = createScreenStore({ path: join(dir, 'screens.json'), clock });
  const access = createAccess({ config, devices, screens, isKey: kioskKeyMatcher(undefined), actorOf: () => 'alex' });
  const hub = createScreenHub({ clock, waitMs: 20, reportMs: 500 });
  const workouts = createScreenWorkouts({ clock, hub, waitMs: 40 });
  const fitness = createFitnessStore({ path: join(dir, 'fitness.json'), clock });
  const api = createRouter();
  api.route('/', createFitnessScreenApi({ fitness, screens, hub, workouts, household: createHousehold(config), access }));

  const phone = async (ownerId: string) => (await devices.claim(devices.createCode(ownerId).code, 'Téléphone'))!.token;
  const start = screens.startPairing({ system: null, app: null });
  const screen = (await screens.confirm(start.code, 'Télé du salon'))!;
  const paired = await screens.pairing(start.id, 0);
  if (paired?.status !== 'paired') throw new Error('télé non appairée');

  type Options = { from?: string; token?: string; body?: unknown; headers?: Record<string, string> };
  const call = async <T = PhoneScreenWorkout>(method: string, path: string, { from = OTHER, token, body, headers }: Options = {}) => {
    const res = await api.request(
      path,
      {
        method,
        headers: { 'Content-Type': 'application/json', ...headers, ...(token && { Authorization: `Bearer ${token}` }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      connectedFrom(from),
    );
    const text = await res.text();
    return { status: res.status, text, json: (text ? JSON.parse(text) : null) as T & { error?: string } };
  };

  /** Fausse appli de la télé : attend ses événements et rend compte de chacun (ok, ou l'échec donné). */
  function tv(failure: string | null = null) {
    const got: ScreenEvent[] = [];
    let on = true;
    void (async () => {
      let after: number | null = null;
      while (on) {
        const { events, last } = await hub.events(screen.id, after);
        after = last;
        for (const e of events) {
          got.push(e);
          hub.report(screen.id, e.id, failure ? { ok: false, reason: failure } : { ok: true });
        }
      }
    })();
    return { got, stop: () => (on = false) };
  }
  const settle = () => new Promise((r) => setTimeout(r, 60));

  return {
    call,
    tv,
    settle,
    screen,
    tvToken: paired.token,
    alex: await phone('alex'),
    sam: await phone('sam'),
    lea: await phone('lea'),
    advance: (ms: number) => (now += ms),
  };
}

describe('Séance de sport sur la télé : droits', () => {
  it('seul le téléphone de la personne, avec un programme', async () => {
    const { call, screen, tvToken, lea, alex } = await setup();
    const body = { screenId: screen.id, session: 1 };
    expect((await call('POST', '/fitness/screen', { from: TABLET, body })).json.error).toBe(OWN_PHONE_ONLY);
    expect((await call('POST', '/fitness/screen', { body })).status).toBe(403);
    expect((await call('POST', '/fitness/screen', { token: lea, body })).json.error).toBe(NO_PROGRAM);
    expect((await call('POST', '/fitness/screen', { token: tvToken, body })).status).toBe(401);
    expect((await call('GET', '/fitness/screens', { from: TABLET })).status).toBe(403);
    const list = await call<WorkoutScreen[]>('GET', '/fitness/screens', { token: alex });
    expect(list.json).toEqual([{ id: screen.id, name: 'Télé du salon', online: false }]);
  });

  it('la télé lit la séance à son jeton seulement, avec la bonne version du protocole', async () => {
    const { call, alex, tvToken } = await setup();
    expect((await call('GET', '/screen/workout', { token: alex, headers: PROTOCOL })).status).toBe(401);
    expect((await call('GET', '/screen/workout', { token: tvToken })).status).toBe(426);
    expect((await call<ScreenWorkoutState>('GET', '/screen/workout', { token: tvToken, headers: PROTOCOL })).json).toEqual({ rev: 0, workout: null });
  });
});

describe('Séance de sport sur la télé : déroulé', () => {
  it('lancée depuis le téléphone : la page s’ouvre, la télé ne reçoit rien de personnel', async () => {
    const { call, tv, screen, alex, tvToken } = await setup();
    const telly = tv();
    const started = await call('POST', '/fitness/screen', { token: alex, body: { screenId: screen.id, session: 2 } });
    expect(started.status).toBe(201);
    expect(started.json).toMatchObject({ screen: { id: screen.id, name: 'Télé du salon' }, session: 2, index: 0, left: 60_000, paused: false, phase: 'running' });
    expect(telly.got).toEqual([expect.objectContaining({ kind: 'workout', action: 'start', page: SCREEN_WORKOUT_PAGE })]);
    const seen = await call<ScreenWorkoutState>('GET', '/screen/workout', { token: tvToken, headers: PROTOCOL });
    expect(Object.keys(seen.json.workout!).sort()).toEqual(['index', 'left', 'paused', 'plan']);
    expect(Object.keys(seen.json.workout!.plan).sort()).toEqual(['effort', 'exercises', 'rest', 'rounds']);
    expect(seen.text).not.toMatch(/alex|Alex|session|palier|rpe|waist/u);
    telly.stop();
  });

  it('pause, suivant, arrêter ; la télé efface tout, le téléphone garde la séance à noter', async () => {
    const { call, tv, settle, screen, alex, tvToken, advance } = await setup();
    const telly = tv();
    await call('POST', '/fitness/screen', { token: alex, body: { screenId: screen.id, session: 1 } });
    advance(10_000);
    expect((await call('POST', '/fitness/screen/command', { token: alex, body: { command: 'pause' } })).json).toMatchObject({ paused: true, left: 50_000 });
    advance(120_000);
    expect((await call('GET', '/fitness/screen', { token: alex })).json).toMatchObject({ index: 0, left: 50_000 });
    expect((await call('POST', '/fitness/screen/command', { token: alex, body: { command: 'next' } })).json).toMatchObject({ index: 1, left: 60_000, paused: true });
    expect((await call('POST', '/fitness/screen/command', { token: alex, body: { command: 'pause' } })).json).toMatchObject({ paused: false });
    const stopped = await call('POST', '/fitness/screen/command', { token: alex, body: { command: 'stop' } });
    expect(stopped.json).toMatchObject({ phase: 'done', stopped: true, session: 1 });
    await settle();
    expect(telly.got.at(-1)).toMatchObject({ kind: 'workout', action: 'end', notice: { title: 'Séance arrêtée' } });
    expect((await call<ScreenWorkoutState>('GET', '/screen/workout', { token: tvToken, headers: PROTOCOL })).json.workout).toBeNull();
    expect((await call('GET', '/fitness/screen', { token: alex })).json).toMatchObject({ phase: 'done' });
    expect((await call('DELETE', '/fitness/screen', { token: alex })).status).toBe(204);
    expect((await call('GET', '/fitness/screen', { token: alex })).json).toBeNull();
    expect((await call('POST', '/fitness/screen/command', { token: alex, body: { command: 'next' } })).json.error).toBe(NO_SCREEN_WORKOUT);
    telly.stop();
  });

  it('fin naturelle : « Séance terminée » sur la télé, puis plus rien', async () => {
    const { call, tv, settle, screen, alex, tvToken, advance } = await setup();
    const telly = tv();
    await call('POST', '/fitness/screen', { token: alex, body: { screenId: screen.id, session: 3 } });
    advance(TOTAL_MS - 1_000);
    expect((await call('GET', '/fitness/screen', { token: alex })).json).toMatchObject({ phase: 'running', left: 1_000 });
    advance(1_000);
    expect((await call<ScreenWorkoutState>('GET', '/screen/workout', { token: tvToken, headers: PROTOCOL })).json.workout).toBeNull();
    expect((await call('GET', '/fitness/screen', { token: alex })).json).toMatchObject({ phase: 'done', stopped: false });
    await settle();
    expect(telly.got.at(-1)).toMatchObject({ kind: 'workout', action: 'end', notice: { title: 'Séance terminée', subtitle: 'Bravo !' } });
    telly.stop();
  });

  it('la télé attend le prochain changement (interrogation longue)', async () => {
    const { call, tv, screen, alex, tvToken } = await setup();
    const telly = tv();
    const { json } = await call('POST', '/fitness/screen', { token: alex, body: { screenId: screen.id, session: 1 } });
    const waiting = call<ScreenWorkoutState>('GET', `/screen/workout?after=${json.rev}`, { token: tvToken, headers: PROTOCOL });
    await call('POST', '/fitness/screen/command', { token: alex, body: { command: 'pause' } });
    const seen = (await waiting).json;
    expect(seen.rev).toBeGreaterThan(json.rev);
    expect(seen.workout).toMatchObject({ paused: true });
    telly.stop();
  });
});

describe('Séance de sport sur la télé : refus', () => {
  it('télé prise par quelqu’un d’autre : 409 ; la même personne relance la sienne', async () => {
    const { call, tv, screen, alex, sam } = await setup();
    const telly = tv();
    await call('POST', '/fitness/screen', { token: alex, body: { screenId: screen.id, session: 1 } });
    expect((await call('POST', '/fitness/screen', { token: sam, body: { screenId: screen.id, session: 1 } })).json.error).toBe(SCREEN_BUSY);
    expect((await call('POST', '/fitness/screen/command', { token: sam, body: { command: 'stop' } })).status).toBe(404);
    expect((await call('POST', '/fitness/screen', { token: alex, body: { screenId: screen.id, session: 2 } })).json).toMatchObject({ session: 2, phase: 'running' });
    telly.stop();
  });

  it('télé absente : 503 ; page pas ouverte : 502, aucune séance', async () => {
    const { call, tv, screen, alex } = await setup();
    const absent = await call('POST', '/fitness/screen', { token: alex, body: { screenId: screen.id, session: 1 } });
    expect(absent).toMatchObject({ status: 503, json: { error: SCREEN_OFFLINE } });
    const telly = tv('page introuvable');
    const refused = await call('POST', '/fitness/screen', { token: alex, body: { screenId: screen.id, session: 1 } });
    expect(refused).toMatchObject({ status: 502, json: { error: 'Télé du salon : page introuvable' } });
    expect((await call('GET', '/fitness/screen', { token: alex })).json).toBeNull();
    expect((await call('POST', '/fitness/screen', { token: alex, body: { screenId: 'inconnue', session: 1 } })).status).toBe(404);
    telly.stop();
  });
});
