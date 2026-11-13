// Routes de « J'ai cuisiné » : la proposition (lecture ouverte, comme le menu et le stock), le décompte d'un repas du
// menu ou d'une recette hors menu, son annulation, et le rappel des repas passés pas encore notés (rien de personnel :
// un nombre). Écrire : toute la famille, comme le stock (la tablette, avec ou sans personne reconnue, et tout téléphone
// appairé). Les règles sont dans services/cook.ts et shared/cook.ts ; ici, validation, droits et réponses.
import { z } from 'zod';
import { type CookProposal, type CookResult, type CookUndo, ESTIMATES } from '../shared/cook.ts';
import { MENU_LIMITS } from '../shared/menu.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { type CookRefusal, type CookService, isCookRefusal } from './services/cook.ts';

export type CookApiDeps = { service: CookService; access: Access };

const count = z.number().int().min(0).max(99);
const answer = z.discriminatedUnion('action', [
  z.object({ action: z.literal('unused') }),
  z.object({ action: z.literal('remove'), count: count.min(1) }),
  z.object({ action: z.literal('left'), finished: count, estimate: z.union([z.literal(ESTIMATES[0]), z.literal(ESTIMATES[1]), z.literal(ESTIMATES[2])]).nullable() }),
  z.object({ action: z.literal('empty') }),
  z.object({ action: z.literal('kept') }),
]);
const reply = z.object({ key: z.string().min(1).max(MENU_LIMITS.name), code: z.string().min(1).max(40), container: z.string().min(1).max(60).nullable().default(null), answer });
const people = z.number().int().min(1).max(MENU_LIMITS.people).nullable().default(null);
const entrySchema = z.object({ people, replies: z.array(reply).max(150) });
const recipeSchema = entrySchema.extend({ entryId: z.string().min(1).max(100).nullable().default(null) });

const REFUSALS: Record<CookRefusal['refused'], [400 | 404 | 409, string]> = {
  'unknown-recipe': [404, 'Recette inconnue'],
  'unknown-meal': [404, 'Repas du menu inconnu'],
  'unknown-cook': [404, 'Décompte inconnu ou déjà annulé'],
  closed: [400, 'Trop tard : un repas se note (ou s’annule) jusqu’à deux jours après la fin de sa semaine'],
  already: [409, 'Repas déjà noté cuisiné'],
  'not-cooked': [409, 'Ce repas n’est pas noté cuisiné'],
  mismatch: [400, 'Ce repas n’est pas cette recette'],
  invalid: [400, 'Réponse impossible'],
};

function orRefuse<T>(result: T | CookRefusal): T {
  if (!isCookRefusal(result)) return result;
  const [status, message] = REFUSALS[result.refused];
  return fail(status, result.message ?? message);
}

/** Personnes demandées (?people=), ou null. */
function peopleQuery(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= MENU_LIMITS.people ? value : fail(400, 'Personnes : un nombre entier');
}

export function createCookApi({ service, access }: CookApiDeps) {
  const api = createRouter();

  api.get('/menu/reminder', async (c) => c.json(await service.reminder()));

  api.get('/menu/entries/:id/cook', async (c) =>
    c.json<CookProposal>(orRefuse(await service.proposal({ recipeId: null, entryId: c.req.param('id'), people: peopleQuery(c.req.query('people')) }))),
  );

  api.post('/menu/entries/:id/cook', async (c) => {
    const input = await readBody(c, entrySchema, z.prettifyError);
    const author = await access.appliance(c);
    return c.json<CookResult>(orRefuse(await service.cook(null, { entryId: c.req.param('id'), ...input }, author)), 201);
  });

  api.delete('/menu/entries/:id/cook', async (c) => {
    await access.appliance(c);
    return c.json<CookUndo>(orRefuse(await service.uncook(c.req.param('id'))));
  });

  /** ?entry= : un repas de cette recette ; « none » : hors menu ; absent : le repas pris d'office. */
  api.get('/recipes/:id/cook', async (c) => {
    const entry = c.req.query('entry');
    const entryId = entry === undefined || entry === '' ? undefined : entry === 'none' ? null : entry;
    return c.json<CookProposal>(orRefuse(await service.proposal({ recipeId: c.req.param('id'), entryId, people: peopleQuery(c.req.query('people')) })));
  });

  api.post('/recipes/:id/cook', async (c) => {
    const input = await readBody(c, recipeSchema, z.prettifyError);
    const author = await access.appliance(c);
    return c.json<CookResult>(orRefuse(await service.cook(c.req.param('id'), input, author)), 201);
  });

  /** « Annuler » du bandeau (repas ou hors menu). */
  api.delete('/cooks/:cook', async (c) => {
    await access.appliance(c);
    return c.json<CookUndo>(orRefuse(await service.undo(c.req.param('cook'))));
  });

  return api;
}
