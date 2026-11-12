// Notes et commentaires de la famille sur les recettes (recipe-notes.json dans le dossier d'état), à part du carnet :
// une note ajoutée ou résolue ne touche ni notre version ni sa date de modification, et le carnet reste léger à
// relire (menu, ingrédients connus). Quand une recette est retirée, ses notes partent avec elle (`removeRecipe`).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type NoteAuthor, type NotePatch, RECIPE_NOTE_LIMITS, type RecipeNote } from '../../shared/recipe-notes.ts';
import { createJsonFile } from './json-file.ts';
import { sameShape } from './schemas.ts';
import type { Clock } from './types.ts';

const noteAuthorSchema = z.object({ ownerId: z.string(), via: z.enum(['tablet', 'phone']) });

const noteSchema = z.object({
  id: z.string(),
  recipeId: z.string(),
  text: z.string(),
  by: noteAuthorSchema,
  at: z.string(),
  editedAt: z.string().optional(),
  editedBy: noteAuthorSchema.optional(),
  resolvedAt: z.string().optional(),
  resolvedBy: noteAuthorSchema.optional(),
});
sameShape<z.infer<typeof noteSchema>, RecipeNote>(true);

const fileSchema = z.object({ version: z.literal(1), notes: z.array(noteSchema) });
type NotesFile = z.infer<typeof fileSchema>;

export type RecipeNoteStore = {
  /** Notes d'une recette, dans l'ordre d'ajout. */
  list(recipeId: string): Promise<RecipeNote[]>;
  get(id: string): Promise<RecipeNote | null>;
  /** Notes ouvertes par recette (pastille des cartes du carnet). */
  openCounts(): Promise<Map<string, number>>;
  /** null : la recette a déjà son maximum de notes. */
  add(recipeId: string, text: string, by: NoteAuthor): Promise<RecipeNote | null>;
  /** Texte remplacé, ou note résolue ou rouverte ; null si la note n'existe pas. */
  change(id: string, patch: NotePatch, by: NoteAuthor): Promise<RecipeNote | null>;
  remove(id: string): Promise<boolean>;
  /** Toutes les notes d'une recette retirée du carnet ; renvoie combien. */
  removeRecipe(recipeId: string): Promise<number>;
};

export function createRecipeNoteStore({ path, clock }: { path: string; clock: Clock }): RecipeNoteStore {
  const state = createJsonFile<NotesFile>({ path, schema: fileSchema, initial: () => ({ version: 1, notes: [] }) });

  return {
    async list(recipeId) {
      return (await state.read()).notes.filter((n) => n.recipeId === recipeId);
    },

    async get(id) {
      return (await state.read()).notes.find((n) => n.id === id) ?? null;
    },

    async openCounts() {
      const counts = new Map<string, number>();
      for (const note of (await state.read()).notes) {
        if (note.resolvedAt === undefined) counts.set(note.recipeId, (counts.get(note.recipeId) ?? 0) + 1);
      }
      return counts;
    },

    async add(recipeId, text, by) {
      return state.update(
        (draft) => {
          if (draft.notes.filter((n) => n.recipeId === recipeId).length >= RECIPE_NOTE_LIMITS.perRecipe) return null;
          const note: RecipeNote = { id: randomUUID(), recipeId, text, by, at: clock().toISOString() };
          draft.notes.push(note);
          return note;
        },
        (note) => note !== null,
      );
    },

    async change(id, { text, resolved }, by) {
      return state.update(
        (draft) => {
          const note = draft.notes.find((n) => n.id === id);
          if (!note) return null;
          const now = clock().toISOString();
          if (text !== undefined && text !== note.text) Object.assign(note, { text, editedAt: now, editedBy: by });
          if (resolved === true && note.resolvedAt === undefined) Object.assign(note, { resolvedAt: now, resolvedBy: by });
          if (resolved === false) {
            delete note.resolvedAt;
            delete note.resolvedBy;
          }
          return note;
        },
        (note) => note !== null,
      );
    },

    async remove(id) {
      return state.update(
        (draft) => {
          const before = draft.notes.length;
          draft.notes = draft.notes.filter((n) => n.id !== id);
          return draft.notes.length < before;
        },
        (removed) => removed,
      );
    },

    async removeRecipe(recipeId) {
      return state.update(
        (draft) => {
          const before = draft.notes.length;
          draft.notes = draft.notes.filter((n) => n.recipeId !== recipeId);
          return before - draft.notes.length;
        },
        (removed) => removed > 0,
      );
    },
  };
}
