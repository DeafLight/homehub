// Routes du mode cuisine d'une recette sur la télé (fonction 13 de l'appli HomeHub TV). Depuis la fiche recette
// (tablette, ou téléphone appairé) : les télés et leur mode cuisine, « Sur la télé » (la télé ouvre sa vue cuisine et
// le confirme), l'étape suivante ou précédente, la fin. Depuis la télé, à son jeton : ce qu'elle affiche (attente
// courte, réveillée par un changement d'étape), l'étape choisie aux flèches, le minuteur d'une durée citée par l'étape
// (OK), l'arrêt d'un minuteur qui sonne, la fin (Retour). Les minuteurs sont ceux de la maison (sources/timers.ts) :
// visibles aussi sur la tablette ; lancés depuis la télé, ils ont pour auteur qui a lancé le mode cuisine.
import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { z } from 'zod';
import { type ScreenCook, type ScreenCookTarget, screenCookView } from '../shared/screen-cook.ts';
import { timerLabel } from '../shared/recipes.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { checkProtocol } from './screen-api.ts';
import type { ScreenCooking } from './services/screen-cook.ts';
import type { ScreenHub } from './services/screens.ts';
import type { RecipeStore } from './sources/recipes.ts';
import type { ScreenStore } from './sources/screens.ts';
import { MAX_TIMERS, type TimerStore } from './sources/timers.ts';
import type { Clock } from './sources/types.ts';

/** Attente de la télé qui ouvre sa vue cuisine (lancement de l'écran, puis compte rendu). */
export const COOK_OPEN_MS = 8_000;
export const NO_COOK = 'Pas de recette en cours sur cette télé';
export const NOT_A_STEP_DURATION = 'Durée qui n’est pas citée par l’étape en cours';
export const TIMER_NOT_RINGING = 'Seul un minuteur qui sonne s’arrête depuis la télé';

const startSchema = z.object({ recipeId: z.string().min(1).max(100), index: z.number().int().min(0).max(1000).default(0) });
const stepSchema = z.object({ index: z.number().int().min(0).max(1000) });
const timerSchema = z.object({ seconds: z.number().int().min(1).max(24 * 3600) });

const afterOf = (c: Context) => {
  const raw = c.req.query('after');
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fail(400, 'Paramètre after : entier positif');
};

export function createScreenCookApi({
  screens,
  hub,
  cooking,
  recipes,
  timers,
  access,
  clock,
}: {
  screens: ScreenStore;
  hub: ScreenHub;
  cooking: ScreenCooking;
  recipes: RecipeStore;
  timers: TimerStore;
  access: Access;
  clock: Clock;
}) {
  const api = createRouter();

  const screenOf = async (id: string) => (await screens.list()).find((s) => s.id === id) ?? fail(404, 'Télé inconnue');

  /** Ce qu'affiche la télé ; null sans mode cuisine (ou recette retirée depuis : le mode cuisine s'arrête). */
  async function viewOf(screenId: string): Promise<ScreenCook | null> {
    const entry = cooking.get(screenId);
    if (!entry) return null;
    const recipe = await recipes.get(entry.recipeId);
    if (!recipe) {
      cooking.stop(screenId);
      return null;
    }
    return screenCookView(recipe, entry, timers.list(), clock());
  }

  /** Étape `index` de la recette en cours sur la télé ; 404 sans mode cuisine. */
  async function goTo(screenId: string, index: number) {
    const entry = cooking.get(screenId) ?? fail(404, NO_COOK);
    const recipe = await recipes.get(entry.recipeId);
    cooking.step(screenId, index, recipe?.ours.steps.length ?? 0);
    return (await viewOf(screenId)) ?? fail(404, NO_COOK);
  }

  // --- La télé ---

  api.get('/screen/cook', async (c) => {
    checkProtocol(c);
    const screen = await access.screen(c);
    await cooking.wait(screen.id, afterOf(c), c.req.raw.signal);
    return c.json({ cook: await viewOf(screen.id) });
  });

  api.post('/screen/cook/step', async (c) => {
    checkProtocol(c);
    const screen = await access.screen(c);
    const { index } = await readBody(c, stepSchema, 'Étape attendue');
    return c.json({ cook: await goTo(screen.id, index) });
  });

  // OK sur « Lancer 10 min » : le minuteur de la maison, au nom de l'étape (comme depuis la tablette).
  api.post('/screen/cook/timers', async (c) => {
    checkProtocol(c);
    const screen = await access.screen(c);
    const { seconds } = await readBody(c, timerSchema, 'Durée attendue');
    const entry = cooking.get(screen.id) ?? fail(404, NO_COOK);
    const view = (await viewOf(screen.id)) ?? fail(404, NO_COOK);
    if (!view.step?.durations.some((d) => d.seconds === seconds)) return fail(400, NOT_A_STEP_DURATION);
    if (!timers.start(timerLabel(view.title, view.step.number), seconds, entry.by)) return fail(409, `${MAX_TIMERS} minuteurs au plus`);
    return c.json({ cook: await viewOf(screen.id) }, 201);
  });

  api.delete('/screen/cook/timers/:id', async (c) => {
    checkProtocol(c);
    const screen = await access.screen(c);
    const timer = timers.list().find((t) => t.id === c.req.param('id')) ?? fail(404, 'Minuteur inconnu');
    if (new Date(timer.endsAt) > clock()) return fail(403, TIMER_NOT_RINGING);
    timers.stop(timer.id);
    return c.json({ cook: await viewOf(screen.id) });
  });

  api.delete('/screen/cook', async (c) => {
    checkProtocol(c);
    const screen = await access.screen(c);
    cooking.stop(screen.id);
    return c.body(null, 204);
  });

  // --- La fiche recette (tablette, téléphone appairé) ---

  api.get('/screens/cook', async (c) => {
    await access.appliance(c);
    const list = await screens.list();
    return c.json(await Promise.all(list.map(async (s): Promise<ScreenCookTarget> => ({ id: s.id, name: s.name, online: hub.online(s.id), cook: await viewOf(s.id) }))));
  });

  api.post('/screens/:id/cook', async (c) => {
    const by = await access.appliance(c);
    const screen = await screenOf(c.req.param('id'));
    const { recipeId, index } = await readBody(c, startSchema, 'Recette attendue');
    const recipe = (await recipes.get(recipeId)) ?? fail(404, 'Recette inconnue');
    // Télé absente ou qui n'a pas ouvert sa vue cuisine : le mode cuisine d'avant reste tel quel.
    const previous = cooking.get(screen.id);
    const restore = () => (previous ? cooking.start(screen.id, previous.recipeId, previous.index, previous.by) : cooking.stop(screen.id));
    cooking.start(screen.id, recipe.id, Math.min(index, Math.max(recipe.ours.steps.length - 1, 0)), by);
    const report = await hub.send(screen.id, { kind: 'cook', id: randomUUID() }, COOK_OPEN_MS).catch((err: unknown) => {
      restore();
      throw err;
    });
    if (!report.ok) {
      restore();
      return fail(502, `${screen.name} : ${report.reason}`);
    }
    const body: ScreenCookTarget = { id: screen.id, name: screen.name, online: hub.online(screen.id), cook: await viewOf(screen.id) };
    return c.json(body, 201);
  });

  api.post('/screens/:id/cook/step', async (c) => {
    await access.appliance(c);
    const screen = await screenOf(c.req.param('id'));
    const { index } = await readBody(c, stepSchema, 'Étape attendue');
    return c.json({ cook: await goTo(screen.id, index) });
  });

  api.delete('/screens/:id/cook', async (c) => {
    await access.appliance(c);
    const screen = await screenOf(c.req.param('id'));
    cooking.stop(screen.id);
    return c.body(null, 204);
  });

  return api;
}
