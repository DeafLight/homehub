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
import { createListsStore } from './sources/lists.ts';
import { createNotesStore } from './sources/notes.ts';
import { createPinStore } from './sources/pins.ts';
import { createSourceStatus } from './sources/source-status.ts';
import { fakeSources, fixedClock, NOW, silentLogger, testConfig } from './testing.ts';

function setup(staticRoot?: string) {
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
  const app = createApp({ config, service, nas, lists, notes, devices, pins, clock: fixedClock, version: '9.9.9', staticRoot });
  return { app, config };
}

/** Requête de la tablette (en test, l'adresse locale compte comme la tablette). */
const put = (body: unknown, address = '127.0.0.1') => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-Real-IP': address },
  body: JSON.stringify(body),
});

describe('API', () => {
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
    const { app } = setup();
    const res = await app.request('/api/dashboard/alex/tasks/t1', put({ done: true }));
    expect(res.status).toBe(200);
    const dashboard = await (await app.request('/api/dashboard/alex')).json();
    expect(dashboard.tasks[0].done).toBe(true);
  });

  it('PUT une tâche : 400 si le corps est invalide, 404 si la tâche est inconnue', async () => {
    const { app } = setup();
    expect((await app.request('/api/dashboard/alex/tasks/t1', put({ done: 'oui' }))).status).toBe(400);
    expect((await app.request('/api/dashboard/alex/tasks/absente', put({ done: true }))).status).toBe(404);
    // Autre appareil du réseau, non appairé : lecture seule.
    expect((await app.request('/api/dashboard/alex/tasks/t1', put({ done: true }, '192.168.1.20'))).status).toBe(403);
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
