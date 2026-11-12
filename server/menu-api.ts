// Routes du menu de la semaine. Lecture ouverte comme le reste de l'API (le menu est familial, rien de personnel).
// Modifier le menu (recettes, personnes, jour), les coches « j'en ai déjà », les décisions « à vérifier au placard »,
// « Acheter maintenant » (frais d'un repas tardif avancés),
// les placards et les liens entre le stock et les ingrédients : un parent (son téléphone, ou reconnu à la tablette),
// comme la liste de courses que ces changements recalculent. Chaque modification est suivie de la synchronisation de
// la liste (services/menu.ts).
import { z } from 'zod';
import { UNITS } from '../shared/ingredients.ts';
import { CHECK_DECISIONS, isWeek, MENU_LIMITS, type MenuView, weekDays, weekOf } from '../shared/menu.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { editableWeek, type MenuService } from './services/menu.ts';
import type { MenuStore } from './sources/menus.ts';
import type { RecipeStore } from './sources/recipes.ts';
import type { Clock } from './sources/types.ts';

export type MenuApiDeps = { menus: MenuStore; service: MenuService; recipes: RecipeStore; access: Access; clock: Clock };

export const PARENTS_ONLY = 'Seul un parent peut modifier le menu';

const week = z.string().refine(isWeek, 'semaine : le lundi, AAAA-MM-JJ');
const people = z.number().int().min(1).max(MENU_LIMITS.people);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'jour AAAA-MM-JJ').nullable();
const addSchema = z.object({ week, recipeId: z.string().min(1).max(100), people: people.optional(), day: day.default(null) });
const updateSchema = z.object({ people: people.optional(), day: day.optional() });
const haveSchema = z.object({ week, key: z.string().trim().min(1).max(MENU_LIMITS.name), have: z.boolean() });
const nowSchema = z.object({ week, key: z.string().trim().min(1).max(MENU_LIMITS.name), now: z.boolean() });
const checkSchema = z.object({ week, key: z.string().trim().min(1).max(MENU_LIMITS.name), decision: z.enum(CHECK_DECISIONS).nullable() });
const pantrySchema = z.object({ names: z.array(z.string().trim().min(1).max(MENU_LIMITS.name)).max(MENU_LIMITS.pantry) });
const linkSchema = z.object({
  link: z
    .object({
      key: z.string().trim().min(1).max(MENU_LIMITS.name),
      name: z.string().trim().min(1).max(MENU_LIMITS.name),
      per: z.object({ quantity: z.number().positive().max(100_000), unit: z.enum(UNITS) }).nullable(),
      partial: z.boolean().optional(),
    })
    .nullable(),
});
const code = (raw: string) => (/^\d{8,14}$/u.test(raw) ? raw : fail(400, 'Code-barres attendu'));

export function createMenuApi({ menus, service, recipes, access, clock }: MenuApiDeps) {
  const api = createRouter();
  const parent = (c: Parameters<Access['parent']>[0]) => access.parent(c, PARENTS_ONLY);

  /** Semaine qu'on peut encore changer : ni passée, ni trop loin devant. */
  function checkWeek(value: string) {
    const state = editableWeek(value, clock(), MENU_LIMITS.weeksAhead);
    if (state === 'past') fail(400, 'Semaine passée : le menu se consulte seulement');
    if (state === 'far') fail(400, `Menu prévu au plus ${MENU_LIMITS.weeksAhead} semaines à l’avance`);
  }
  const checkDay = (value: string | null, inWeek: string) => {
    if (value !== null && !weekDays(inWeek).includes(value)) fail(400, 'Ce jour n’est pas dans la semaine');
  };

  api.get('/menu', async (c) => {
    const asked = c.req.query('week') ?? weekOf(clock());
    if (!isWeek(asked)) return fail(400, 'Semaine attendue : le lundi, AAAA-MM-JJ');
    await service.refreshIfNewDay();
    return c.json((await service.view(asked)) satisfies MenuView);
  });

  api.post('/menu/entries', async (c) => {
    const input = await readBody(c, addSchema, z.prettifyError);
    const author = await parent(c);
    checkWeek(input.week);
    checkDay(input.day, input.week);
    const recipe = (await recipes.get(input.recipeId)) ?? fail(404, 'Recette inconnue');
    const { weeks } = await menus.data();
    if ((weeks[input.week]?.length ?? 0) >= MENU_LIMITS.entries) return fail(400, `Au plus ${MENU_LIMITS.entries} recettes par semaine`);
    const entry = await menus.addEntry(
      input.week,
      { recipeId: recipe.id, title: recipe.ours.title, people: input.people ?? Math.min(recipe.ours.servings ?? 4, MENU_LIMITS.people), day: input.day },
      author,
    );
    await service.sync(author);
    return c.json(entry, 201);
  });

  api.put('/menu/entries/:id', async (c) => {
    const input = await readBody(c, updateSchema, z.prettifyError);
    const author = await parent(c);
    const inWeek = (await menus.weekOfEntry(c.req.param('id'))) ?? fail(404, 'Recette du menu inconnue');
    checkWeek(inWeek);
    if (input.day !== undefined) checkDay(input.day, inWeek);
    const updated = (await menus.updateEntry(c.req.param('id'), input)) ?? fail(404, 'Recette du menu inconnue');
    await service.sync(author);
    return c.json(updated.entry);
  });

  api.delete('/menu/entries/:id', async (c) => {
    const author = await parent(c);
    const inWeek = (await menus.weekOfEntry(c.req.param('id'))) ?? fail(404, 'Recette du menu inconnue');
    checkWeek(inWeek);
    await menus.removeEntry(c.req.param('id'));
    await service.sync(author);
    return c.body(null, 204);
  });

  api.put('/menu/have', async (c) => {
    const input = await readBody(c, haveSchema, z.prettifyError);
    const author = await parent(c);
    checkWeek(input.week);
    await menus.setHave(input.week, input.key, input.have);
    await service.sync(author);
    return c.body(null, 204);
  });

  /** Frais d'un repas tardif : « Acheter maintenant » (`now: true`) ou remettre à plus tard (`now: false`). */
  api.put('/menu/now', async (c) => {
    const input = await readBody(c, nowSchema, z.prettifyError);
    const author = await parent(c);
    checkWeek(input.week);
    await menus.setNow(input.week, input.key, input.now);
    await service.sync(author);
    return c.body(null, 204);
  });

  /** « À vérifier au placard » : « J'en ai assez » (`enough`), « Il en faut » (`needed`), ou oublier (`null`). */
  api.put('/menu/check', async (c) => {
    const input = await readBody(c, checkSchema, z.prettifyError);
    const author = await parent(c);
    checkWeek(input.week);
    await menus.setCheck(input.week, input.key, input.decision);
    await service.sync(author);
    return c.body(null, 204);
  });

  api.put('/menu/pantry', async (c) => {

    const { names } = await readBody(c, pantrySchema, z.prettifyError);
    const author = await parent(c);
    const saved = await menus.setPantry(names);
    await service.sync(author);
    return c.json({ names: saved });
  });

  /** Relier un produit à un ingrédient (`link`), ou « pas un ingrédient » (`link: null`). */
  api.put('/menu/links/:code', async (c) => {
    const { link } = await readBody(c, linkSchema, z.prettifyError);
    const author = await parent(c);
    await menus.setLink(code(c.req.param('code')), link);
    await service.sync(author);
    return c.body(null, 204);
  });

  /** Oublier la décision : le produit est de nouveau proposé. */
  api.delete('/menu/links/:code', async (c) => {
    const author = await parent(c);
    await menus.setLink(code(c.req.param('code')), undefined);
    await service.sync(author);
    return c.body(null, 204);
  });

  return api;
}
