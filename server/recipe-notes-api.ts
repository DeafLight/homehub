// Routes des notes de la famille sur une recette. Lecture ouverte comme le reste du carnet (familial, rien de
// personnel). Laisser une note : tout membre identifié (son téléphone, ou reconnu à la tablette), enfants compris ;
// un appareil non appairé ne fait que lire. Modifier le texte, résoudre, rouvrir ou retirer une note : son auteur ou
// un parent (`access.authorOrParent`). Les notes d'une recette retirée partent avec elle (recipes-api.ts).
import { z } from 'zod';
import { cleanNoteText, RECIPE_NOTE_LIMITS, type RecipeNote } from '../shared/recipe-notes.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import type { RecipeNoteStore } from './sources/recipe-notes.ts';
import type { RecipeStore } from './sources/recipes.ts';

export type RecipeNotesApiDeps = { recipes: RecipeStore; notes: RecipeNoteStore; access: Access };

export const NOT_YOUR_NOTE = 'Seul un parent, ou qui a écrit la note, peut la modifier';
export const TOO_MANY_NOTES = `Déjà ${RECIPE_NOTE_LIMITS.perRecipe} notes sur cette recette : retire les plus anciennes`;

const textSchema = z
  .string()
  .transform(cleanNoteText)
  .pipe(z.string().min(1, 'Note vide').max(RECIPE_NOTE_LIMITS.text, `Note trop longue (${RECIPE_NOTE_LIMITS.text} caractères au plus)`));
const addSchema = z.object({ text: textSchema });
const patchSchema = z
  .object({ text: textSchema.optional(), resolved: z.boolean().optional() })
  .refine((p) => p.text !== undefined || p.resolved !== undefined, 'Texte ou état de la note attendu');

export function createRecipeNotesApi({ recipes, notes, access }: RecipeNotesApiDeps) {
  const api = createRouter();

  const recipeOf = async (id: string) => (await recipes.get(id)) ?? fail(404, 'Recette inconnue');
  /** La note, si elle est bien sur cette recette. */
  const noteOf = async (recipeId: string, id: string): Promise<RecipeNote> => {
    const note = await notes.get(id);
    return note && note.recipeId === recipeId ? note : fail(404, 'Note inconnue');
  };

  api.get('/recipes/:id/notes', async (c) => {
    const recipe = await recipeOf(c.req.param('id'));
    return c.json({ notes: await notes.list(recipe.id) });
  });

  api.post('/recipes/:id/notes', async (c) => {
    const { text } = await readBody(c, addSchema);
    const recipe = await recipeOf(c.req.param('id'));
    const author = await access.writer(c, null);
    const by = { ownerId: author.ownerId ?? fail(403, 'Profil inconnu'), via: author.via };
    return c.json((await notes.add(recipe.id, text, by)) ?? fail(409, TOO_MANY_NOTES), 201);
  });

  api.patch('/recipes/:id/notes/:note', async (c) => {
    const patch = await readBody(c, patchSchema);
    const note = await noteOf(c.req.param('id'), c.req.param('note'));
    const by = await access.authorOrParent(c, note.by.ownerId, NOT_YOUR_NOTE);
    return c.json((await notes.change(note.id, patch, by)) ?? fail(404, 'Note inconnue'));
  });

  api.delete('/recipes/:id/notes/:note', async (c) => {
    const note = await noteOf(c.req.param('id'), c.req.param('note'));
    await access.authorOrParent(c, note.by.ownerId, NOT_YOUR_NOTE);
    await notes.remove(note.id);
    return c.body(null, 204);
  });

  return api;
}
