// Menu de la semaine (menus.json dans le dossier d'état) : les recettes de chaque semaine (lundi), les coches
// « j'en ai déjà » de chaque semaine, les placards toujours ignorés, et les liens entre produits du stock et
// ingrédients, confirmés une fois puis retenus par produit. Les semaines passées restent lisibles quelques mois
// (MENU_LIMITS.weeksKept), puis sont oubliées avec leurs coches.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { UNITS } from '../../shared/ingredients.ts';
import { addWeeks, DEFAULT_PANTRY, MENU_LIMITS, type MenuEntry, type StockLink, weekOf } from '../../shared/menu.ts';
import type { Author } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema, sameShape } from './schemas.ts';
import type { Clock } from './types.ts';

const entrySchema = z.object({
  id: z.string(),
  recipeId: z.string(),
  title: z.string(),
  people: z.number().int().min(1),
  day: z.string().nullable(),
  addedBy: authorSchema,
  addedAt: z.string(),
});
sameShape<z.infer<typeof entrySchema>, MenuEntry>(true);

const linkSchema = z.object({
  key: z.string(),
  name: z.string(),
  per: z.object({ quantity: z.number().positive(), unit: z.enum(UNITS) }).nullable(),
});
sameShape<z.infer<typeof linkSchema>, StockLink>(true);

const fileSchema = z.object({
  version: z.literal(1),
  weeks: z.record(z.string(), z.array(entrySchema)),
  have: z.record(z.string(), z.array(z.string())),
  /** Noms des placards ; null : jamais réglés (DEFAULT_PANTRY). */
  pantry: z.array(z.string()).nullable(),
  /** Code-barres → ingrédient, ou null : « pas un ingrédient » (plus proposé). */
  links: z.record(z.string(), linkSchema.nullable()),
});
type MenusFile = z.infer<typeof fileSchema>;

export type MenuData = {
  weeks: Record<string, MenuEntry[]>;
  have: Record<string, string[]>;
  pantry: string[];
  links: Record<string, StockLink | null>;
};

export type NewEntry = Pick<MenuEntry, 'recipeId' | 'title' | 'people' | 'day'>;

export type MenuStore = {
  data(): Promise<MenuData>;
  addEntry(week: string, entry: NewEntry, by: Author): Promise<MenuEntry>;
  /** Personnes ou jour ; null si l'entrée n'existe pas. */
  updateEntry(id: string, change: Partial<Pick<MenuEntry, 'people' | 'day'>>): Promise<{ week: string; entry: MenuEntry } | null>;
  removeEntry(id: string): Promise<boolean>;
  /** Semaine d'une entrée, ou null. */
  weekOfEntry(id: string): Promise<string | null>;
  setHave(week: string, key: string, have: boolean): Promise<void>;
  setPantry(names: string[]): Promise<string[]>;
  /** Lien d'un produit (null : pas un ingrédient) ; `undefined` : oublier la décision (de nouveau proposé). */
  setLink(code: string, link: StockLink | null | undefined): Promise<void>;
};

export function createMenuStore({ path, clock }: { path: string; clock: Clock }): MenuStore {
  const state = createJsonFile<MenusFile>({
    path,
    schema: fileSchema,
    initial: () => ({ version: 1, weeks: {}, have: {}, pantry: null, links: {} }),
    beforeSave(draft) {
      const oldest = addWeeks(weekOf(clock()), -MENU_LIMITS.weeksKept);
      for (const record of [draft.weeks, draft.have]) {
        for (const week of Object.keys(record)) if (week < oldest || record[week].length === 0) delete record[week];
      }
    },
  });

  const findEntry = (file: MenusFile, id: string) => {
    for (const [week, entries] of Object.entries(file.weeks)) {
      const entry = entries.find((e) => e.id === id);
      if (entry) return { week, entry };
    }
    return null;
  };

  return {
    async data() {
      const file = await state.read();
      return { weeks: file.weeks, have: file.have, pantry: file.pantry ?? DEFAULT_PANTRY, links: file.links };
    },

    addEntry(week, entry, by) {
      return state.update((file) => {
        const stored: MenuEntry = { id: randomUUID(), ...entry, addedBy: by, addedAt: clock().toISOString() };
        (file.weeks[week] ??= []).push(stored);
        return stored;
      });
    },

    updateEntry(id, change) {
      return state.update(
        (file) => {
          const found = findEntry(file, id);
          if (found) Object.assign(found.entry, change);
          return found;
        },
        (found) => found !== null,
      );
    },

    removeEntry(id) {
      return state.update(
        (file) => {
          const found = findEntry(file, id);
          if (found) file.weeks[found.week] = file.weeks[found.week].filter((e) => e.id !== id);
          return found !== null;
        },
        (removed) => removed,
      );
    },

    async weekOfEntry(id) {
      return findEntry(await state.read(), id)?.week ?? null;
    },

    setHave(week, key, have) {
      return state.update((file) => {
        const keys = new Set(file.have[week] ?? []);
        if (have) keys.add(key);
        else keys.delete(key);
        file.have[week] = [...keys];
      });
    },

    setPantry(names) {
      return state.update((file) => {
        file.pantry = [...new Set(names)];
        return file.pantry;
      });
    },

    setLink(code, link) {
      return state.update((file) => {
        if (link === undefined) delete file.links[code];
        else file.links[code] = link;
      });
    },
  };
}
