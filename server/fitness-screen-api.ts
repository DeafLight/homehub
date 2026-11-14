// Routes de la séance de sport guidée sur la télé (fonction 12 de l'appli HomeHub TV). Le téléphone de la personne, et
// lui seul (access.ownPhone : ni la tablette, ni un parent pour un autre, ni une télé), choisit une télé, lance sa
// séance, la pilote (pause, suivant, arrêter) et l'abandonne une fois notée ; la note passe par POST
// /api/fitness/sessions, comme une séance faite sans la télé. La télé, à son jeton, lit la séance en cours par
// interrogation longue : rythme, exercices, étape, temps restant, rien de personnel (shared/screen-workout.ts).
import type { Context } from 'hono';
import { z } from 'zod';
import { SCREEN_PROTOCOL, SCREEN_PROTOCOL_HEADER } from '../shared/screen.ts';
import { SCREEN_WORKOUT_COMMANDS, screenPlanOf, type WorkoutScreen } from '../shared/screen-workout.ts';
import type { Access } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { OUTDATED_APP } from './screen-api.ts';
import type { ScreenHub } from './services/screens.ts';
import type { ScreenWorkouts } from './services/screen-workouts.ts';
import type { FitnessStore } from './sources/fitness.ts';
import type { ScreenStore } from './sources/screens.ts';

export const NO_PROGRAM = 'Pas de programme sur ce profil';

const startSchema = z.object({ screenId: z.string().min(1).max(100), session: z.union([z.literal(1), z.literal(2), z.literal(3)]) });
const commandSchema = z.object({ command: z.enum(SCREEN_WORKOUT_COMMANDS) });

export function createFitnessScreenApi({
  fitness,
  screens,
  hub,
  workouts,
  household,
  access,
}: {
  fitness: FitnessStore;
  screens: ScreenStore;
  hub: ScreenHub;
  workouts: ScreenWorkouts;
  household: Household;
  access: Access;
}) {
  const api = createRouter();

  /** Le téléphone de la personne, si son profil a un programme. */
  async function owner(c: Context): Promise<string> {
    const id = await access.ownPhone(c);
    return household.member(id)?.fitness ? id : fail(404, NO_PROGRAM);
  }

  // --- Le téléphone de la personne ---

  api.get('/fitness/screens', async (c) => {
    await owner(c);
    return c.json((await screens.list()).map((s): WorkoutScreen => ({ id: s.id, name: s.name, online: hub.online(s.id) })));
  });

  api.get('/fitness/screen', async (c) => c.json(workouts.phone(await owner(c))));

  api.post('/fitness/screen', async (c) => {
    const id = await owner(c);
    const { screenId, session } = await readBody(c, startSchema, 'Télé et séance attendues');
    const screen = (await screens.list()).find((s) => s.id === screenId) ?? fail(404, 'Télé inconnue');
    const plan = screenPlanOf(fitness.get(id), session);
    return c.json(await workouts.start({ ownerId: id, screen: { id: screen.id, name: screen.name }, session, plan }), 201);
  });

  api.post('/fitness/screen/command', async (c) => {
    const id = await owner(c);
    const { command } = await readBody(c, commandSchema, 'Ordre attendu : pause, next ou stop');
    return c.json(workouts.command(id, command));
  });

  api.delete('/fitness/screen', async (c) => {
    workouts.dismiss(await owner(c));
    return c.body(null, 204);
  });

  // --- La télé (page de la séance, dans la WebView de l'appli) ---

  api.get('/screen/workout', async (c) => {
    if (c.req.header(SCREEN_PROTOCOL_HEADER) !== String(SCREEN_PROTOCOL)) return fail(426, OUTDATED_APP);
    const screen = await access.screen(c);
    const raw = c.req.query('after');
    const after = raw === undefined || raw === '' ? null : Number(raw);
    if (after !== null && !(Number.isInteger(after) && after >= 0)) return fail(400, 'Paramètre after : entier positif');
    c.header('Cache-Control', 'no-store');
    return c.json(await workouts.waitScreen(screen.id, after, c.req.raw.signal));
  });

  return api;
}
