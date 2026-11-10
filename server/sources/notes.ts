// Mots de la famille : un membre en laisse un à un autre (ou à toute la famille), depuis son téléphone ou la
// tablette. Enregistrés dans le dossier d'état (notes.json), comme les listes. Un mot s'efface quand son destinataire
// l'a vu, et au plus tard au bout de NOTE_KEPT_DAYS jours.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Author, Note } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema } from './schemas.ts';
import type { Clock, NoteSource } from './types.ts';

export const NOTE_MAX = 200;
export const NOTE_KEPT_DAYS = 7;
const DAY_MS = 86_400_000;

const fileSchema = z.object({
  version: z.literal(1),
  notes: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      to: z.string(),
      from: authorSchema,
      at: z.string(),
      seenAt: z.string().optional(),
      seenBy: authorSchema.optional(),
    }),
  ),
});

type NotesFile = z.infer<typeof fileSchema>;

export type NotesStore = NoteSource & {
  /** Mots des NOTE_KEPT_DAYS derniers jours, vus ou non, du plus récent au plus ancien. */
  list(): Promise<Note[]>;
  add(to: string, text: string, from: Author): Promise<Note>;
  /** Marque le mot comme vu ; null s'il n'existe pas (ou plus). */
  markSeen(id: string, by: Author): Promise<Note | null>;
};

export function createNotesStore({ path, clock }: { path: string; clock: Clock }): NotesStore {
  const recent = (note: Note) => clock().getTime() - new Date(note.at).getTime() < NOTE_KEPT_DAYS * DAY_MS;
  const state = createJsonFile<NotesFile>({ path, schema: fileSchema, initial: () => ({ version: 1, notes: [] }) });

  /** Une modification à la fois ; les mots trop anciens sont oubliés au passage. */
  const change = <T>(apply: (file: NotesFile) => T): Promise<T> =>
    state.update((file) => {
      file.notes = file.notes.filter(recent);
      return apply(file);
    });

  const sorted = (notes: Note[]) => notes.filter(recent).sort((a, b) => b.at.localeCompare(a.at));

  return {
    async list() {
      return sorted((await state.read()).notes);
    },

    async unseenFor(ownerId) {
      return sorted((await state.read()).notes.filter((n) => n.to === ownerId && !n.seenAt));
    },

    add(to, text, from) {
      const note: Note = { id: randomUUID(), text, to, from, at: clock().toISOString() };
      return change((file) => {
        file.notes.push(note);
        return note;
      });
    },

    markSeen(id, by) {
      return change((file) => {
        const note = file.notes.find((n) => n.id === id);
        if (!note) return null;
        if (!note.seenAt) Object.assign(note, { seenAt: clock().toISOString(), seenBy: by });
        return { ...note };
      });
    },
  };
}
