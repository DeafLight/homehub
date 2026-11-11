// Routes du carnet de recettes. Lecture ouverte comme le reste de l'API (le carnet est familial, rien de personnel).
// Importer ou saisir une recette : tout membre identifié (téléphone appairé, ou personne reconnue à la tablette),
// enfants compris. Modifier notre version, ou relire la page d'origine (sans écraser ce que notre version a modifié) :
// un parent, ou celui qui a ajouté la recette. Retirer : un parent.
import { z } from 'zod';
import { type ImportResult, mergeReread, type Recipe, type RecipeDraft, type RereadResult } from '../shared/recipes.ts';
import type { Access } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { siteName } from './sources/recipe-page.ts';
import type { RecipeStore } from './sources/recipes.ts';
import { PageError } from './sources/web-page.ts';
import { contentInputSchema, normalizeContent, type RecipeImporter } from './services/recipes.ts';
import type { Clock } from './sources/types.ts';

export type RecipesApiDeps = {
  recipes: RecipeStore;
  /** Absent (tests sans réseau) : l'import propose la saisie à la main. */
  importer?: RecipeImporter;
  household: Household;
  access: Access;
  clock: Clock;
};

/** Réponse d'un import : la recette (nouvelle ou déjà au carnet), ou de quoi la saisir à la main et pourquoi. */
export type ImportResponse = ImportResult | { draft: RecipeDraft; reason: string };

const importSchema = z.object({ url: z.string().trim().min(1).max(2000) });
const createSchema = z.object({ content: contentInputSchema, url: z.string().trim().max(2000).url().nullish() });
const updateSchema = z.object({ content: contentInputSchema });

export const NOT_YOURS = 'Seul un parent, ou qui a ajouté la recette, peut la modifier';

/** Premier lien http(s) d'un texte partagé (« Regarde ça https://… »). */
export function firstLink(text: string): string | null {
  return /https?:\/\/[^\s<>"']+/iu.exec(text)?.[0].replace(/[).,;!?»]+$/u, '') ?? null;
}

export function createRecipesApi({ recipes, importer, household, access, clock }: RecipesApiDeps) {
  const api = createRouter();

  const recipeOf = async (id: string): Promise<Recipe> => (await recipes.get(id)) ?? fail(404, 'Recette inconnue');

  api.get('/recipes', async (c) => c.json({ recipes: await recipes.list() }));

  api.get('/recipes/:id', async (c) => c.json(await recipeOf(c.req.param('id'))));

  api.get('/recipes/:id/photo', async (c) => {
    const photo = (await recipes.photo(c.req.param('id'))) ?? fail(404, 'Pas de photo');
    c.header('Content-Type', photo.type);
    c.header('Cache-Control', 'private, max-age=86400');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(photo.body as Uint8Array<ArrayBuffer>);
  });

  api.post('/recipes/import', async (c) => {
    const input = await readBody(c, importSchema, 'Corps attendu : { "url": "https://…" }');
    // Droit vérifié avant de lire quoi que ce soit sur le réseau.
    const author = await access.writer(c, null);
    const url = firstLink(input.url) ?? fail(400, 'Lien de recette attendu (http ou https)');
    const known = await recipes.findBySource(url);
    if (known) return c.json({ recipe: known, existing: true } satisfies ImportResponse);
    const draftOf = (title: string | null, site: string | null, reason: string): ImportResponse => ({ draft: { url, title, site }, reason });
    if (!importer) return c.json(draftOf(null, siteName(url), 'Lecture des pages indisponible'));
    let read;
    try {
      read = await importer.read(url);
    } catch (err) {
      if (!(err instanceof PageError)) throw err;
      if (err.kind === 'invalid' || err.kind === 'forbidden') return fail(400, err.message);
      return c.json(draftOf(null, siteName(url), err.message));
    }
    if (!read.found) return c.json(draftOf(read.title, read.site, 'Aucune recette lisible sur cette page'));
    // L'adresse finale (après redirection) peut aussi être déjà au carnet.
    const again = read.url !== url ? await recipes.findBySource(read.url) : null;
    if (again) return c.json({ recipe: again, existing: true } satisfies ImportResponse);
    const source = { url: read.url, site: read.site, importedAt: clock().toISOString(), imageUrl: read.imageUrl, content: read.content };
    const recipe = await recipes.add({ ours: structuredClone(read.content), source, photo: read.photo }, author);
    return c.json({ recipe, existing: false } satisfies ImportResponse, 201);
  });

  /** Saisie à la main (rien de lisible sur la page, ou recette de famille). */
  api.post('/recipes', async (c) => {
    const input = await readBody(c, createSchema, z.prettifyError);
    const author = await access.writer(c, null);
    const ours = normalizeContent(input.content);
    const source = input.url ? { url: input.url, site: siteName(input.url), importedAt: clock().toISOString(), imageUrl: null, content: null } : null;
    return c.json(await recipes.add({ ours, source }, author), 201);
  });

  /** Qui modifie : un parent, ou qui a ajouté la recette. */
  async function editor(c: Parameters<Access['writer']>[0], recipe: Recipe) {
    const author = await access.writer(c, null);
    const parent = household.member(author.ownerId ?? '')?.parent === true;
    if (!parent && recipe.addedBy.ownerId !== author.ownerId) return fail(403, NOT_YOURS);
    return author;
  }

  api.put('/recipes/:id', async (c) => {
    const input = await readBody(c, updateSchema, z.prettifyError);
    const recipe = await recipeOf(c.req.param('id'));
    const author = await editor(c, recipe);
    return c.json((await recipes.update(recipe.id, normalizeContent(input.content), author)) ?? fail(404, 'Recette inconnue'));
  });

  /** « Relire la source » : la page est relue, les parties que notre version n'a pas modifiées en sont reprises. */
  api.post('/recipes/:id/reread', async (c) => {
    const recipe = await recipeOf(c.req.param('id'));
    const author = await editor(c, recipe);
    if (!recipe.source) return fail(400, 'Recette saisie à la main, sans page à relire');
    if (!importer) return fail(503, 'Lecture des pages indisponible');
    let read;
    try {
      read = await importer.read(recipe.source.url);
    } catch (err) {
      if (!(err instanceof PageError)) throw err;
      return fail(err.kind === 'invalid' || err.kind === 'forbidden' ? 400 : 502, err.message);
    }
    if (!read.found) return fail(422, 'Aucune recette lisible sur cette page');
    const { ours, updated, kept } = mergeReread(recipe.ours, recipe.source.content, read.content);
    const source = { url: recipe.source.url, site: read.site, importedAt: clock().toISOString(), imageUrl: read.imageUrl, content: read.content };
    const saved = (await recipes.reread(recipe.id, { source, ours, photo: read.photo }, author)) ?? fail(404, 'Recette inconnue');
    return c.json({ recipe: saved, updated, kept } satisfies RereadResult);
  });

  api.delete('/recipes/:id', async (c) => {
    await recipeOf(c.req.param('id'));
    await access.parent(c, 'Seul un parent peut retirer une recette du carnet');
    await recipes.remove(c.req.param('id'));
    return c.body(null, 204);
  });

  return api;
}
