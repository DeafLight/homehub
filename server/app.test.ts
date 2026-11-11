import { mkdtempSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { parseConfig } from './config.ts';
import { createConfigStore } from './config-store.ts';
import { createDashboardService } from './services/dashboard.ts';
import { createNasService } from './services/nas.ts';
import { createDeviceStore } from './sources/devices.ts';
import { createActorSessions, createFaceStore } from './sources/faces.ts';
import { createListsStore } from './sources/lists.ts';
import { createNotesStore } from './sources/notes.ts';
import { createPinStore, PARENT_PIN_ID } from './sources/pins.ts';
import { createRoutinePlanStore } from './sources/routine-plans.ts';
import { createFitnessStore } from './sources/fitness.ts';
import { createRecipeStore } from './sources/recipes.ts';
import { createStockStore } from './sources/stock.ts';
import { createSourceStatus } from './sources/source-status.ts';
import { buildGtfsIndex, unzip } from './sources/gtfs.ts';
import { createTimerStore } from './sources/timers.ts';
import { createTransitSettingsStore } from './sources/transit-settings.ts';
import { createHolidaySettingsStore } from './sources/holiday-settings.ts';
import { connectedFrom, fakeSources, fixedClock, GTFS_FILES, NOW, silentLogger, testConfig, zip } from './testing.ts';

function setup(staticRoot?: string, clock = fixedClock) {
  const config = createConfigStore(testConfig);
  const sources = fakeSources({ tasks: { alex: [{ id: 't1', label: 'Poubelles', done: false }] } });
  const service = createDashboardService({ config, sources, clock: fixedClock, logger: silentLogger() });
  const sourceStatus = createSourceStatus(fixedClock);
  sourceStatus.record('Agenda CAL_A', new Error('HTTP 404'));
  const nas = createNasService({ nasStatus: { read: async () => null }, sourceStatus, version: '9.9.9', startedAt: NOW });
  const dir = mkdtempSync(join(tmpdir(), 'homehub-app-'));
  const lists = createListsStore({ path: join(dir, 'lists.json'), clock: fixedClock });
  const devices = createDeviceStore({ path: join(dir, 'devices.json'), clock: fixedClock });
  const pins = createPinStore({ path: join(dir, 'pins.json'), clock: fixedClock });
  const notes = createNotesStore({ path: join(dir, 'notes.json'), clock: fixedClock });
  const faces = createFaceStore({ path: join(dir, 'faces.json') });
  const sessions = createActorSessions(fixedClock);
  const timers = createTimerStore({ clock });
  const plans = createRoutinePlanStore({ path: join(dir, 'routine-plans.json'), clock: fixedClock, config });
  const transitSettings = createTransitSettingsStore({ path: join(dir, 'transit-settings.json'), clock: fixedClock, config });
  const index = buildGtfsIndex(unzip(zip(GTFS_FILES)));
  const searchAddress = async (q: string) => [{ label: `${q}, Angers`, lat: 47.47, lon: -0.55 }];
  const app = createApp({
    config,
    service,
    nas,
    lists,
    notes,
    devices,
    pins,
    faces,
    sessions,
    timers,
    plans,
    stock: createStockStore({ path: join(dir, 'stock.json'), clock: fixedClock }),
    fitness: createFitnessStore({ path: join(dir, 'fitness.json'), clock: fixedClock }),
    recipes: createRecipeStore({ path: join(dir, 'recipes.json'), photosDir: join(dir, 'recipes'), clock: fixedClock }),
    transitSettings,
    holidaySettings: createHolidaySettingsStore({ path: join(dir, 'holiday-settings.json'), clock: fixedClock, config }),
    gtfs: { index: async () => index },
    searchAddress,
    clock,
    version: '9.9.9',
    staticRoot,
  });
  // Alex reconnu devant la tablette (configuration de test : pas de parent, chacun écrit sur son profil).
  const { token } = sessions.open('alex', 10);
  /**
   * Requête de la tablette (connexion locale directe, qui compte comme la tablette), au nom d'Alex sauf `actor: null` :
   * arguments de `app.request` après le chemin (corps et environnement de la connexion).
   */
  const put = (body: unknown, { address = '127.0.0.1', actor = token as string | null, method = 'PUT' } = {}) =>
    [
      {
        method,
        headers: { 'Content-Type': 'application/json', ...(actor && { 'X-Actor-Session': actor }) },
        body: JSON.stringify(body),
      },
      connectedFrom(address),
    ] as const;
  return { app, config, put, sessions, pins, faces };
}

describe('API', () => {
  it('transports : réservés à la tablette, adresses, arrêts et lignes ; enregistrés par un parent seulement', async () => {
    const { app, config, put } = setup();
    const local = [undefined, connectedFrom('127.0.0.1')] as const;
    expect((await app.request('/api/transit/settings', undefined, connectedFrom('192.168.1.50'))).status).toBe(403);
    expect(await (await app.request('/api/transit/settings', ...local)).json()).toEqual({ places: [], commutes: {}, stops: [], saved: false });
    const { addresses } = await (await app.request('/api/transit/addresses?q=1%20rue%20Haute', ...local)).json();
    expect(addresses).toEqual([{ label: '1 rue Haute, Angers', lat: 47.47, lon: -0.55 }]);
    expect((await (await app.request('/api/transit/stops?q=mair', ...local)).json()).stops.map((s: { id: string }) => s.id)).toEqual(['1MAIR']); // 2MAIR : terminus seulement
    expect((await (await app.request('/api/transit/stops?near=47.47,-0.55', ...local)).json()).stops[0].id).toBe('1MAIR');
    expect((await app.request('/api/transit/stops?near=ici', ...local)).status).toBe(400);
    const { routes } = await (await app.request('/api/transit/routes?from=47.47,-0.55&to=47.48,-0.55', ...local)).json();
    expect(routes.map((r: { line: string }) => r.line)).toEqual(['A']);

    const place = (id: string, label: string, lat: number) => ({ id, label, icon: 'place', address: label, lat, lon: -0.55 });
    const { totalMinutes: _, ...route } = routes[0];
    const commute = { from: 'p1', to: 'p2', route, mode: 'school', days: [1, 2, 3, 4, 5], window: { from: '07:00', to: '08:30' }, arriveBefore: 10, showBefore: 30, walkFrom: null, walkTo: 3 };
    const body = { places: [place('p1', 'Maison', 47.47), place('p2', 'Collège', 47.48)], commutes: { lea: commute }, stops: [{ id: '1MAIR', label: 'Mairie' }] };
    expect((await app.request('/api/transit/settings', ...put(body))).status).toBe(403); // Alex n'est pas parent
    config.set(parseConfig({ members: [{ id: 'alex', name: 'Alex', color: '#5b8def', parent: true }, { id: 'lea', name: 'Léa', color: '#3fb8a8' }] }));
    expect((await app.request('/api/transit/settings', ...put({ ...body, commutes: { zoe: commute } }))).status).toBe(400);
    expect((await app.request('/api/transit/settings', ...put({ ...body, commutes: { lea: { ...commute, to: 'p9' } } }))).status).toBe(400);
    const saved = await (await app.request('/api/transit/settings', ...put(body))).json();
    expect(saved).toMatchObject({ saved: true, stops: [{ id: '1MAIR', label: 'Mairie' }] });
    expect(saved.commutes.lea.walkTo).toBe(3);
  });

  it('visages : une série de prises anormalement uniforme est refusée, une série variée enregistrée', async () => {
    const { app, put, pins, faces } = setup();
    await pins.set(PARENT_PIN_ID, '2468');
    const take = (seed: number, noise: number) => Array.from({ length: 64 }, (_, i) => Math.sin(seed * 31 + i) * noise);
    // Tablette qui calcule mal : dix prises presque identiques.
    const uniform = Array.from({ length: 10 }, (_, k) => take(1, 1).map((v, i) => v + Math.sin(k * 7 + i) * 0.01));
    const refused = await app.request('/api/faces/alex', ...put({ embeddings: uniform, pin: '2468' }, { method: 'POST' }));
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toContain('Empreintes anormales');
    expect(await faces.enrolled()).toEqual([]);
    // Vrai visage qui bouge : des prises qui varient.
    const varied = Array.from({ length: 10 }, (_, k) => take(1, 1).map((v, i) => v + Math.sin(k * 7 + i * 3) * 0.6));
    expect((await app.request('/api/faces/alex', ...put({ embeddings: varied, pin: '2468' }, { method: 'POST' }))).status).toBe(204);
    const overview = await (await app.request('/api/faces', undefined, connectedFrom('127.0.0.1'))).json();
    expect(overview.samples.alex).toEqual({ enrolled: 10, learned: 0, uniform: false });
  });

  it('vacances scolaires : réglage lu par la tablette, modifié par un parent ; aperçu validé', async () => {
    const { app, config, put, sessions } = setup();
    const local = [undefined, connectedFrom('127.0.0.1')] as const;
    const path = '/api/school/holidays/settings';
    expect((await app.request(path, undefined, connectedFrom('192.168.1.50'))).status).toBe(403);
    const initial = await (await app.request(path, ...local)).json();
    expect(initial).toMatchObject({ choice: null, saved: false });
    expect(initial.academies).toContainEqual({ name: 'Corse', zone: 'Corse' });

    expect((await app.request(path, ...put({ choice: { zone: 'B' } }))).status).toBe(403); // Alex n'est pas parent
    config.set(parseConfig({ members: [{ id: 'alex', name: 'Alex', color: '#5b8def', parent: true }, { id: 'lea', name: 'Léa', color: '#3fb8a8' }] }));
    expect((await app.request(path, ...put({ choice: { zone: 'B' } }, { actor: null }))).status).toBe(403);
    expect((await app.request(path, ...put({ choice: { zone: 'B' } }, { actor: sessions.open('lea', 10).token }))).status).toBe(403); // enfant
    const refused = await app.request(path, ...put({ choice: { academie: 'Atlantide' } }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/Réglages refusés : académie inconnue/);
    expect((await app.request(path, ...put({ choice: { zone: 'D' } }))).status).toBe(400);
    expect(await (await app.request(path, ...put({ choice: { academie: 'orleans-tours' } }))).json()).toMatchObject({ choice: { academie: 'Orléans-Tours' }, saved: true });
    expect(await (await app.request(path, ...put({ choice: null }))).json()).toMatchObject({ choice: null, saved: true });

    // Aperçu : tablette ou téléphone appairé, académie ou zone valide (service de test sans calendrier).
    expect((await app.request('/api/school/holidays?zone=B', undefined, connectedFrom('192.168.1.50'))).status).toBe(403);
    expect((await app.request('/api/school/holidays?zone=D', ...local)).status).toBe(400);
    expect((await app.request('/api/school/holidays?academie=Atlantide', ...local)).status).toBe(400);
    expect(await (await app.request('/api/school/holidays?academie=Nantes', ...local)).json()).toEqual({ holiday: null, zone: null, holidays: null });
    expect((await app.request('/api/school/holidays', undefined, connectedFrom('192.168.1.50'))).status).toBe(200); // lecture ouverte
  });

  it('routines : lues par tous, modifiées par un parent seulement', async () => {
    const { app, config, put, sessions } = setup();
    const windows = { morning: { from: '06:30', to: '08:30' }, evening: { from: '19:00', to: '21:00' } };
    const body = { members: { lea: { morning: [{ id: 'x1', label: 'Dents', days: null }], evening: [] } }, windows };
    expect((await (await app.request('/api/routines')).json()).members.lea).toEqual({ morning: [], evening: [] });

    expect((await app.request('/api/routines', ...put(body))).status).toBe(403); // Alex n'est pas parent
    expect((await app.request('/api/routines', ...put(body, { actor: null }))).status).toBe(403);
    config.set(parseConfig({ members: [{ id: 'alex', name: 'Alex', color: '#5b8def', parent: true }, { id: 'lea', name: 'Léa', color: '#3fb8a8' }] }));
    expect((await app.request('/api/routines', ...put({ ...body, members: { zoe: body.members.lea } }))).status).toBe(400);
    expect((await app.request('/api/routines', ...put({ ...body, windows: { ...windows, evening: { from: '22:00', to: '21:00' } } }))).status).toBe(400);
    const lea = sessions.open('lea', 10).token;
    expect((await app.request('/api/routines', ...put(body, { actor: lea }))).status).toBe(403); // enfant

    const res = await app.request('/api/routines', ...put(body));
    expect(res.status).toBe(200);
    expect(await (await app.request('/api/dashboard/lea/routine')).json()).toEqual({ routine: null }); // service de test sans routines
    expect((await app.request('/api/dashboard/zoe/routine')).status).toBe(404);
    expect(await (await app.request('/api/dashboard/lea/homework')).json()).toEqual({ homework: null }); // pas de cahier de texte
    expect((await app.request('/api/dashboard/zoe/homework')).status).toBe(404);
    const saved = await app.request('/api/routines');
    expect(await saved.json()).toMatchObject({ windows, members: { lea: body.members.lea, alex: { morning: [], evening: [] } } });
  });

  it('minuteurs : lancés et arrêtés par une personne reconnue, visibles par tous', async () => {
    const { app, put } = setup();
    const send = (method: string, path: string, body?: unknown, actor?: string | null) =>
      app.request(path, ...put(body ?? {}, { ...(actor === undefined ? {} : { actor }), method }));

    expect((await send('POST', '/api/timers', { label: 'Cuisson', seconds: 300 }, null)).status).toBe(403); // personne reconnu
    expect((await send('POST', '/api/timers', { seconds: 5 })).status).toBe(400);
    const started = await send('POST', '/api/timers', { label: 'Cuisson', seconds: 300 });
    expect(started.status).toBe(201);
    const timer = await started.json();
    expect(timer).toMatchObject({ label: 'Cuisson', durationSeconds: 300, endsAt: new Date(NOW.getTime() + 300_000).toISOString() });
    expect(await (await app.request('/api/timers')).json()).toEqual([timer]);
    expect((await send('DELETE', `/api/timers/${timer.id}`, undefined, null)).status).toBe(403);
    expect((await send('DELETE', `/api/timers/${timer.id}`)).status).toBe(204);
    expect((await send('DELETE', `/api/timers/${timer.id}`)).status).toBe(404);
  });

  it("minuteur qui sonne : la tablette l'arrête sans personne reconnue, un appareil inconnu non", async () => {
    let now = NOW.getTime();
    const { app, put } = setup(undefined, () => new Date(now));
    const send = (method: string, path: string, options: { actor?: string | null; address?: string } = {}) =>
      app.request(path, ...put({ seconds: 10 }, { ...options, method }));
    const { id } = await (await send('POST', '/api/timers')).json();
    expect((await send('DELETE', `/api/timers/${id}`, { actor: null })).status).toBe(403); // en cours
    now += 20_000;
    expect((await send('DELETE', `/api/timers/${id}`, { actor: null, address: '192.0.2.9' })).status).toBe(403);
    expect((await send('DELETE', `/api/timers/${id}`, { actor: null })).status).toBe(204);
  });

  it('GET /api/health', async () => {
    const { app, config } = setup();
    const res = await app.request('/api/health');
    expect(await res.json()).toEqual({
      status: 'ok',
      version: '9.9.9',
      configRevision: config.revision(),
      time: NOW.toISOString(),
    });
  });

  it('GET /api/config expose les membres, les réglages et la révision', async () => {
    const { app, config } = setup();
    const body = await (await app.request('/api/config')).json();
    expect(body.members.map((m: { id: string }) => m.id)).toEqual(['alex', 'lea']);
    expect(body.ui.idleTimeoutSeconds).toBe(180);
    expect(body.revision).toBe(config.revision());
  });

  it('suit une configuration rechargée', async () => {
    const { app, config } = setup();
    const before = (await (await app.request('/api/health')).json()).configRevision;
    config.set(parseConfig({ members: [{ id: 'tom', name: 'Tom', color: '#d96aa7' }] }));

    const health = await (await app.request('/api/health')).json();
    const body = await (await app.request('/api/config')).json();
    expect(health.configRevision).not.toBe(before);
    expect(body.members.map((m: { id: string }) => m.id)).toEqual(['tom']);
    expect((await app.request('/api/dashboard/alex')).status).toBe(404);
  });

  it('GET /api/home', async () => {
    const res = await setup().app.request('/api/home');
    expect(res.status).toBe(200);
    expect((await res.json()).profiles).toHaveLength(3);
  });

  it('GET /api/weather', async () => {
    const res = await setup().app.request('/api/weather');
    expect(res.status).toBe(200);
    expect((await res.json()).forecast.current.windKmh).toBe(12);
  });

  it('GET /api/nas : relevé du NAS, état des sources et version', async () => {
    const res = await setup().app.request('/api/nas');
    expect(await res.json()).toEqual({
      status: null,
      sources: [{ name: 'Agenda CAL_A', ok: false, at: NOW.toISOString(), error: 'HTTP 404', failingSince: NOW.toISOString() }],
      homehub: { version: '9.9.9', startedAt: NOW.toISOString() },
    });
  });

  it('GET /api/week : semaine en cours par défaut, 400 hors des semaines consultables', async () => {
    const { app } = setup();
    const week = await (await app.request('/api/week')).json();
    expect(week.offset).toBe(0);
    expect(week.owners.map((o: { ownerId: string }) => o.ownerId)).toEqual(['alex', 'lea', 'famille']);
    expect((await (await app.request('/api/week?offset=2')).json()).offset).toBe(2);
    for (const bad of ['-1', '3', '1.5', 'x']) expect((await app.request(`/api/week?offset=${bad}`)).status).toBe(400);
  });

  it('GET /api/dashboard/:id : 200 pour un membre, 404 sinon', async () => {
    const { app } = setup();
    expect((await app.request('/api/dashboard/alex')).status).toBe(200);
    expect((await app.request('/api/dashboard/inconnu')).status).toBe(404);
  });

  it('PUT une tâche : 200, puis visible dans le dashboard', async () => {
    const { app, put } = setup();
    const res = await app.request('/api/dashboard/alex/tasks/t1', ...put({ done: true }));
    expect(res.status).toBe(200);
    const dashboard = await (await app.request('/api/dashboard/alex')).json();
    expect(dashboard.tasks[0].done).toBe(true);
  });

  it('PUT une tâche : 400 si le corps est invalide, 404 si la tâche est inconnue', async () => {
    const { app, put } = setup();
    expect((await app.request('/api/dashboard/alex/tasks/t1', ...put({ done: 'oui' }))).status).toBe(400);
    expect((await app.request('/api/dashboard/alex/tasks/absente', ...put({ done: true }))).status).toBe(404);
    // Autre appareil du réseau, non appairé : lecture seule.
    expect((await app.request('/api/dashboard/alex/tasks/t1', ...put({ done: true }, { address: '192.168.1.20' }))).status).toBe(403);
    // Tablette, personne reconnue : elle le demande.
    const anonymous = await app.request('/api/dashboard/alex/tasks/t1', ...put({ done: true }, { actor: null }));
    expect(anonymous.status).toBe(403);
    expect((await anonymous.json()).identify).toBe(true);
    // Alex n'est pas parent : pas sur le profil de Léa.
    expect((await app.request('/api/dashboard/lea/tasks/t1', ...put({ done: true }))).status).toBe(403);
  });

  it('route API inconnue : 404 en JSON', async () => {
    const res = await setup().app.request('/api/nimporte');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Route inconnue' });
  });
});

describe('front statique', () => {
  async function staticApp() {
    const root = await mkdtemp(join(tmpdir(), 'homehub-static-'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>HomeHub</title>');
    await writeFile(join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    return setup(root).app;
  }

  it('sert index.html sans cache pour les routes du front', async () => {
    const res = await (await staticApp()).request('/p/alex');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<title>HomeHub</title>');
  });

  it('sert la racine sans cache', async () => {
    const res = await (await staticApp()).request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('sert les fichiers présents (cache normal), 404 pour un fichier absent', async () => {
    const app = await staticApp();
    const icon = await app.request('/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers.get('cache-control')).toBeNull();
    expect((await app.request('/favicon.ico')).status).toBe(404);
  });
});
