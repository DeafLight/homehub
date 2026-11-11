// Carnet de recettes de la famille (recipes.json dans le dossier d'état) et photos gardées à côté (recipes/<id>).
// Chaque recette a notre version (celle qui sert) et, si elle a été importée, la copie de la source, jamais modifiée.
// Les vraies recettes importées ne vivent qu'ici, jamais dans le dépôt.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { UNITS } from '../../shared/ingredients.ts';
import type { Recipe, RecipeContent, RecipeSource, RecipeSummary } from '../../shared/recipes.ts';
import type { Author } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema, sameShape } from './schemas.ts';
import type { Clock } from './types.ts';

export const lineSchema = z.object({
  id: z.string(),
  text: z.string(),
  quantity: z.number().nullable(),
  quantityMax: z.number().nullable(),
  unit: z.enum(UNITS).nullable(),
  label: z.string(),
  name: z.string(),
  key: z.string(),
  notes: z.string(),
  optional: z.boolean(),
  aisle: z.string().nullable(),
  section: z.string().nullable(),
  manual: z.boolean(),
});

export const contentSchema = z.object({
  title: z.string(),
  servings: z.number().nullable(),
  servingsUnit: z.string().nullable(),
  ingredients: z.array(lineSchema),
  steps: z.array(z.object({ id: z.string(), text: z.string(), section: z.string().nullable() })),
  tips: z.string(),
  prepMinutes: z.number().nullable(),
  cookMinutes: z.number().nullable(),
  totalMinutes: z.number().nullable(),
  appliance: z.literal('cookeo').nullable(),
});
sameShape<z.infer<typeof contentSchema>, RecipeContent>(true);

const sourceSchema = z.object({ url: z.string().nullable(), site: z.string(), origin: z.enum(['text', 'saved-page']).optional(), importedAt: z.string(), imageUrl: z.string().nullable(), content: contentSchema.nullable() });
sameShape<z.infer<typeof sourceSchema>, RecipeSource>(true);

const recipeSchema = z.object({
  id: z.string(),
  ours: contentSchema,
  source: sourceSchema.nullable(),
  photo: z.boolean(),
  /** Type de la photo gardée (image/jpeg…), pour la servir. */
  photoType: z.string().optional(),
  addedBy: authorSchema,
  addedAt: z.string(),
  updatedBy: authorSchema.optional(),
  updatedAt: z.string().optional(),
});
type StoredRecipe = z.infer<typeof recipeSchema>;

const fileSchema = z.object({ version: z.literal(1), recipes: z.array(recipeSchema) });
type RecipesFile = z.infer<typeof fileSchema>;

export type Photo = { body: Uint8Array; type: string };

export type NewRecipe = { ours: RecipeContent; source: RecipeSource | null; photo?: Photo | null };

export type RecipeStore = {
  /** Le carnet, des plus récentes aux plus anciennes. */
  list(): Promise<RecipeSummary[]>;
  get(id: string): Promise<Recipe | null>;
  /** Toutes les recettes, en entier (menu de la semaine, ingrédients connus). */
  all(): Promise<Recipe[]>;
  /** Recette déjà importée depuis cette page (adresse sans fragment ni paramètres de suivi). */
  findBySource(url: string): Promise<Recipe | null>;
  add(recipe: NewRecipe, by: Author): Promise<Recipe>;
  /** Remplace notre version ; null si la recette n'existe pas. */
  update(id: string, ours: RecipeContent, by: Author): Promise<Recipe | null>;
  /** Relecture de la page : nouvelle source, notre version fusionnée, photo ajoutée s'il n'y en avait pas ; null si la recette n'existe pas. */
  reread(id: string, update: { source: RecipeSource; ours: RecipeContent; photo?: Photo | null }, by: Author): Promise<Recipe | null>;
  remove(id: string): Promise<boolean>;
  photo(id: string): Promise<Photo | null>;
};

/** Adresse comparable : sans fragment, sans paramètres de suivi (utm_*, fbclid…), sans « www. ». */
export function sourceKey(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|at_|xtor)/iu.test(name)) url.searchParams.delete(name);
    }
    url.hostname = url.hostname.replace(/^www\./u, '');
    return url.toString().replace(/\/$/u, '');
  } catch {
    return raw;
  }
}

const publicRecipe = ({ photoType: _type, ...recipe }: StoredRecipe): Recipe => recipe;

function summary(recipe: StoredRecipe): RecipeSummary {
  const { ours } = recipe;
  return {
    id: recipe.id,
    photo: recipe.photo,
    addedBy: recipe.addedBy,
    addedAt: recipe.addedAt,
    title: ours.title,
    servings: ours.servings,
    servingsUnit: ours.servingsUnit,
    totalMinutes: ours.totalMinutes,
    appliance: ours.appliance,
    site: recipe.source?.site ?? null,
    ingredients: ours.ingredients.length,
  };
}

export function createRecipeStore({ path, photosDir, clock }: { path: string; photosDir: string; clock: Clock }): RecipeStore {
  const state = createJsonFile<RecipesFile>({ path, schema: fileSchema, initial: () => ({ version: 1, recipes: [] }) });
  const photoPath = (id: string) => join(photosDir, id.replace(/[^\w-]/gu, ''));

  return {
    async list() {
      const { recipes } = await state.read();
      return [...recipes].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).map(summary);
    },

    async all() {
      return (await state.read()).recipes.map(publicRecipe);
    },

    async get(id) {
      const found = (await state.read()).recipes.find((r) => r.id === id);
      return found ? publicRecipe(found) : null;
    },

    async findBySource(url) {
      const key = sourceKey(url);
      const found = (await state.read()).recipes.find((r) => r.source?.url && sourceKey(r.source.url) === key);
      return found ? publicRecipe(found) : null;
    },

    async add({ ours, source, photo }, by) {
      const id = randomUUID();
      if (photo) {
        await mkdir(photosDir, { recursive: true });
        await writeFile(photoPath(id), photo.body, { mode: 0o600 });
      }
      const stored: StoredRecipe = {
        id,
        ours,
        source,
        photo: Boolean(photo),
        ...(photo && { photoType: photo.type }),
        addedBy: by,
        addedAt: clock().toISOString(),
      };
      await state.update((draft) => void draft.recipes.push(stored));
      return publicRecipe(stored);
    },

    async update(id, ours, by) {
      const updated = await state.update(
        (draft) => {
          const recipe = draft.recipes.find((r) => r.id === id);
          if (!recipe) return null;
          Object.assign(recipe, { ours, updatedBy: by, updatedAt: clock().toISOString() });
          return recipe;
        },
        (result) => result !== null,
      );
      return updated ? publicRecipe(updated) : null;
    },

    async reread(id, { source, ours, photo }, by) {
      const before = (await state.read()).recipes.find((r) => r.id === id);
      if (!before) return null;
      const addPhoto = Boolean(photo && !before.photo);
      if (addPhoto && photo) {
        await mkdir(photosDir, { recursive: true });
        await writeFile(photoPath(id), photo.body, { mode: 0o600 });
      }
      const updated = await state.update(
        (draft) => {
          const recipe = draft.recipes.find((r) => r.id === id);
          if (!recipe) return null;
          const changed = JSON.stringify(recipe.ours) !== JSON.stringify(ours);
          Object.assign(recipe, { source, ours }, changed && { updatedBy: by, updatedAt: clock().toISOString() });
          if (addPhoto && photo) Object.assign(recipe, { photo: true, photoType: photo.type });
          return recipe;
        },
        (result) => result !== null,
      );
      return updated ? publicRecipe(updated) : null;
    },

    async remove(id) {
      const removed = await state.update(
        (draft) => {
          const before = draft.recipes.length;
          draft.recipes = draft.recipes.filter((r) => r.id !== id);
          return draft.recipes.length < before;
        },
        (result) => result,
      );
      if (removed) await rm(photoPath(id), { force: true });
      return removed;
    },

    async photo(id) {
      const recipe = (await state.read()).recipes.find((r) => r.id === id);
      if (!recipe?.photo) return null;
      try {
        return { body: await readFile(photoPath(id)), type: recipe.photoType ?? 'image/jpeg' };
      } catch {
        return null;
      }
    },
  };
}
