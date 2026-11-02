import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createDashboardService } from './services/dashboard.ts';
import { fakeSources, fixedClock, NOW, testConfig } from './testing.ts';

function setup() {
  const sources = fakeSources({ tasks: { alex: [{ id: 't1', label: 'Poubelles', done: false }] } });
  const service = createDashboardService({ config: testConfig, sources, clock: fixedClock });
  return createApp({ config: testConfig, service, clock: fixedClock, version: '9.9.9' });
}

const put = (body: unknown) => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('API', () => {
  it('GET /api/health', async () => {
    const res = await setup().request('/api/health');
    expect(await res.json()).toEqual({ status: 'ok', version: '9.9.9', time: NOW.toISOString() });
  });

  it('GET /api/config expose les membres et les réglages', async () => {
    const body = await (await setup().request('/api/config')).json();
    expect(body.members.map((m: { id: string }) => m.id)).toEqual(['alex', 'lea']);
    expect(body.ui.idleTimeoutSeconds).toBe(180);
  });

  it('GET /api/home', async () => {
    const res = await setup().request('/api/home');
    expect(res.status).toBe(200);
    expect((await res.json()).profiles).toHaveLength(3);
  });

  it('GET /api/dashboard/:id : 200 pour un membre, 404 sinon', async () => {
    const app = setup();
    expect((await app.request('/api/dashboard/alex')).status).toBe(200);
    expect((await app.request('/api/dashboard/inconnu')).status).toBe(404);
  });

  it('PUT une tâche : 200, puis visible dans le dashboard', async () => {
    const app = setup();
    const res = await app.request('/api/dashboard/alex/tasks/t1', put({ done: true }));
    expect(res.status).toBe(200);
    const dashboard = await (await app.request('/api/dashboard/alex')).json();
    expect(dashboard.tasks[0].done).toBe(true);
  });

  it('PUT une tâche : 400 si le corps est invalide, 404 si la tâche est inconnue', async () => {
    const app = setup();
    expect((await app.request('/api/dashboard/alex/tasks/t1', put({ done: 'oui' }))).status).toBe(400);
    expect((await app.request('/api/dashboard/alex/tasks/absente', put({ done: true }))).status).toBe(404);
  });

  it('route API inconnue : 404 en JSON', async () => {
    const res = await setup().request('/api/nimporte');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Route inconnue' });
  });
});
