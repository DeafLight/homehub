// Routes de l'accueil et des dashboards : données assemblées par le service (lecture ouverte à tout le réseau de la
// maison), tâches et routine du jour cochées avec les droits du profil.
import { z } from 'zod';
import { type Health, WEEKS_AHEAD } from '../shared/types.ts';
import type { Access } from './access.ts';
import { toPublicConfig } from './config.ts';
import type { ConfigStore } from './config-store.ts';
import { createRouter, fail, readBody } from './http.ts';
import type { DashboardService } from './services/dashboard.ts';
import type { NasService } from './services/nas.ts';
import type { Clock } from './sources/types.ts';

export type DashboardApiDeps = {
  config: ConfigStore;
  service: DashboardService;
  nas: NasService;
  access: Access;
  clock: Clock;
  version: string;
};

const doneSchema = z.object({ done: z.boolean() });
const DONE_EXPECTED = 'Corps attendu : { "done": true|false }';
const weekOffsetSchema = z.coerce.number().int().min(0).max(WEEKS_AHEAD);

export function createDashboardApi({ config, service, nas, access, clock, version }: DashboardApiDeps) {
  const api = createRouter();
  const knownOwner = (ownerId: string) => (service.hasOwner(ownerId) ? ownerId : fail(404, 'Profil inconnu'));

  api.get('/health', (c) => c.json<Health>({ status: 'ok', version, configRevision: config.revision(), time: clock().toISOString() }));

  api.get('/config', (c) => c.json(toPublicConfig(config.current(), config.revision())));

  api.get('/home', async (c) => c.json(await service.home()));

  api.get('/weather', async (c) => c.json({ forecast: await service.weatherForecast() }));

  api.get('/week', async (c) => {
    const offset = weekOffsetSchema.safeParse(c.req.query('offset') ?? 0);
    if (!offset.success) return fail(400, `offset attendu : entier de 0 à ${WEEKS_AHEAD}`);
    return c.json(await service.week(offset.data));
  });

  api.get('/nas', async (c) => c.json(await nas.data()));

  /** Prochains passages Irigo aux arrêts suivis (accueil, veille). */
  api.get('/transit', async (c) => c.json(await service.transit()));

  /** Vacances scolaires : ce qu'on en dit aujourd'hui, la zone et les périodes à venir (rien de personnel). */
  api.get('/school/holidays', async (c) => c.json(await service.holidays()));

  api.get('/dashboard/:ownerId',async (c) => c.json((await service.dashboard(c.req.param('ownerId'))) ?? fail(404, 'Profil inconnu')));

  api.put('/dashboard/:ownerId/tasks/:taskId', async (c) => {
    const { done } = await readBody(c, doneSchema, DONE_EXPECTED);
    const ownerId = c.req.param('ownerId');
    const author = await access.writer(c, ownerId);
    return c.json((await service.setTaskDone(ownerId, c.req.param('taskId'), done, author)) ?? fail(404, 'Tâche inconnue'));
  });

  /** Routine du moment seule (appli du téléphone, sans le reste du dashboard). */
  api.get('/dashboard/:ownerId/routine', async (c) => c.json({ routine: await service.routine(knownOwner(c.req.param('ownerId'))) }));

  /** Devoirs seuls (appli du téléphone), en lecture : on les coche dans Pronote ou ÉcoleDirecte. */
  api.get('/dashboard/:ownerId/homework', async (c) => c.json({ homework: await service.homework(knownOwner(c.req.param('ownerId'))) }));

  /** Routine du jour : mêmes droits que les tâches du profil. */
  api.put('/dashboard/:ownerId/routine/:itemId', async (c) => {
    const { done } = await readBody(c, doneSchema, DONE_EXPECTED);
    const ownerId = c.req.param('ownerId');
    const author = await access.writer(c, ownerId);
    return c.json((await service.setRoutineDone(ownerId, c.req.param('itemId'), done, author)) ?? fail(404, 'Étape inconnue'));
  });

  return api;
}
