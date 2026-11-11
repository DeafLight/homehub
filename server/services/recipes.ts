// Import d'une recette depuis un lien partagé : la page est lue (lecture sûre, voir sources/web-page.ts), la recette
// trouvée par le lecteur schema.org, la photo gardée si elle est une image ordinaire. Et la remise en forme de ce que
// le front envoie pour notre version : limites de taille, identifiants, lignes réanalysées sauf corrections à la main.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { UNITS } from '../../shared/ingredients.ts';
import { RECIPE_LIMITS, type RecipeContent, refreshLine } from '../../shared/recipes.ts';
import { decodePage, readRecipePage } from '../sources/recipe-page.ts';
import type { Photo } from '../sources/recipes.ts';
import { PageError, type PageFetcher } from '../sources/web-page.ts';

export type ImportRead =
  | { found: true; url: string; site: string; content: RecipeContent; imageUrl: string | null; photo: Photo | null }
  | { found: false; url: string; site: string; title: string | null };

export type RecipeImporter = { read(url: string): Promise<ImportRead> };

/** Formats de photo gardés (pas de SVG : il peut porter du script). */
const PHOTO_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/u;
const PHOTO_MAX_BYTES = 4_000_000;

export function createRecipeImporter({ fetchPage }: { fetchPage: PageFetcher }): RecipeImporter {
  async function photoOf(url: string): Promise<Photo | null> {
    try {
      const page = await fetchPage(url, { accept: 'image/avif,image/webp,image/jpeg,image/png,image/*', maxBytes: PHOTO_MAX_BYTES });
      const type = page.contentType.split(';')[0].trim().toLowerCase();
      return PHOTO_TYPES.test(type) && page.body.byteLength > 0 ? { body: page.body, type } : null;
    } catch {
      return null; // une photo absente n'empêche pas l'import
    }
  }

  return {
    async read(url) {
      const page = await fetchPage(url);
      const type = page.contentType.split(';')[0].trim().toLowerCase();
      if (type && !/html|xml/u.test(type)) throw new PageError('invalid', 'Ce lien ne mène pas à une page web');
      const result = readRecipePage(decodePage(page.body, page.contentType), page.url, randomUUID);
      if (!result.found) return { found: false, url: page.url, site: result.site, title: result.title };
      const photo = result.imageUrl ? await photoOf(result.imageUrl) : null;
      return { found: true, url: page.url, site: result.site, content: result.content, imageUrl: result.imageUrl, photo };
    },
  };
}

// --- Notre version, telle que le front l'envoie ---

const text = (max: number) => z.string().trim().max(max);
const minutes = z.number().int().min(0).max(10_000).nullable();
const id = z.string().max(64).optional();

export const contentInputSchema = z.object({
  title: z.string().trim().min(1, 'Titre attendu').max(RECIPE_LIMITS.title),
  servings: z.number().int().min(1).max(100).nullable(),
  servingsUnit: text(40).nullable().default(null),
  ingredients: z
    .array(
      z.object({
        id,
        text: z.string().trim().min(1).max(RECIPE_LIMITS.line),
        quantity: z.number().min(0).max(100_000).nullable().default(null),
        quantityMax: z.number().min(0).max(100_000).nullable().default(null),
        unit: z.enum(UNITS).nullable().default(null),
        label: text(RECIPE_LIMITS.line).default(''),
        name: text(RECIPE_LIMITS.line).default(''),
        notes: text(RECIPE_LIMITS.line).default(''),
        optional: z.boolean().default(false),
        aisle: text(60).nullable().default(null),
        section: text(RECIPE_LIMITS.section).nullable().default(null),
        manual: z.boolean().default(false),
      }),
    )
    .max(RECIPE_LIMITS.ingredients),
  steps: z
    .array(z.object({ id, text: z.string().trim().min(1).max(RECIPE_LIMITS.step), section: text(RECIPE_LIMITS.section).nullable().default(null) }))
    .max(RECIPE_LIMITS.steps),
  tips: text(RECIPE_LIMITS.tips).default(''),
  prepMinutes: minutes.default(null),
  cookMinutes: minutes.default(null),
  totalMinutes: minutes.default(null),
  appliance: z.literal('cookeo').nullable().default(null),
});
export type ContentInput = z.infer<typeof contentInputSchema>;

/**
 * Notre version prête à garder : identifiants uniques (repris s'ils existent), lignes non corrigées réanalysées
 * depuis leur texte, lignes corrigées à la main gardées telles quelles (la correction l'emporte), sections vides
 * ramenées à null.
 */
export function normalizeContent(input: ContentInput): RecipeContent {
  const seen = new Set<string>();
  const uniqueId = (candidate: string | undefined) => {
    const value = candidate && !seen.has(candidate) ? candidate : randomUUID();
    seen.add(value);
    return value;
  };
  const section = (s: string | null) => (s?.trim() ? s.trim() : null);
  return {
    title: input.title,
    servings: input.servings,
    servingsUnit: input.servingsUnit || null,
    ingredients: input.ingredients.map((line) => {
      const manualName = line.manual ? line.name || line.label || line.text : line.name;
      return refreshLine({ ...line, id: uniqueId(line.id), name: manualName, key: '', section: section(line.section) });
    }),
    steps: input.steps.map((step) => ({ id: uniqueId(step.id), text: step.text, section: section(step.section) })),
    tips: input.tips,
    prepMinutes: input.prepMinutes,
    cookMinutes: input.cookMinutes,
    totalMinutes: input.totalMinutes,
    appliance: input.appliance,
  };
}
