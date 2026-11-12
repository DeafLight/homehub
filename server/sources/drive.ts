// Drive (drive.json dans le dossier d'état) : l'enseigne et le magasin de retrait choisis, et pour chaque article de
// la liste de courses (par clé) le produit retenu chez cette enseigne, avec ses produits de secours. Rien de
// personnel : seulement des produits d'un catalogue public et le nom d'un magasin. Les choix sont gardés par enseigne :
// changer d'enseigne ne perd pas ceux de la précédente.
import { z } from 'zod';
import { DRIVE_LIMITS, type DriveChoice, type DriveProduct, type DriveSettings, ENSEIGNES, type Enseigne } from '../../shared/drive.ts';
import { UNITS } from '../../shared/ingredients.ts';
import type { Author } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema, sameShape } from './schemas.ts';
import type { Clock } from './types.ts';

const productSchema = z.object({
  enseigne: z.enum(ENSEIGNES),
  id: z.string(),
  url: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  packText: z.string().nullable(),
  pack: z.object({ quantity: z.number().positive(), unit: z.enum(UNITS) }).nullable(),
  ean: z.string().nullable(),
  source: z.enum(['page', 'manual', 'stock']),
  seenAt: z.string(),
});
sameShape<z.infer<typeof productSchema>, DriveProduct>(true);

const choiceSchema = z.object({
  key: z.string(),
  enseigne: z.enum(ENSEIGNES),
  label: z.string(),
  preferred: productSchema.nullable(),
  fallback: z.array(productSchema),
  updatedAt: z.string(),
  updatedBy: authorSchema,
});
sameShape<z.infer<typeof choiceSchema>, DriveChoice>(true);

const settingsSchema = z.object({
  enseigne: z.enum(ENSEIGNES).nullable(),
  store: z.object({ name: z.string(), url: z.string().nullable() }).nullable(),
});
sameShape<z.infer<typeof settingsSchema>, DriveSettings>(true);

const fileSchema = z.object({ version: z.literal(1), settings: settingsSchema, choices: z.array(choiceSchema) });
type DriveFile = z.infer<typeof fileSchema>;

/** Rôle d'un produit dans un choix : retenu, ou de secours. */
export type DriveRole = 'preferred' | 'fallback';

export type DriveStore = {
  settings(): Promise<DriveSettings>;
  choices(): Promise<DriveChoice[]>;
  setSettings(settings: DriveSettings): Promise<DriveSettings>;
  /**
   * Retient un produit pour un article : comme produit retenu (l'ancien devient un secours) ou comme secours (au plus
   * DRIVE_LIMITS.fallback). Un produit déjà présent dans le choix change de rôle. null : trop de choix.
   */
  choose(input: { key: string; label: string; product: DriveProduct; role: DriveRole }, by: Author): Promise<DriveChoice | null>;
  /**
   * Retire un produit d'un choix (le retenu laisse la place vide : aucun secours n'est pris d'office), ou tout le
   * choix sans `id`. false : rien à retirer.
   */
  forget(key: string, enseigne: Enseigne, id: string | null, by: Author): Promise<boolean>;
};

export function createDriveStore({ path, clock }: { path: string; clock: Clock }): DriveStore {
  const state = createJsonFile<DriveFile>({
    path,
    schema: fileSchema,
    initial: () => ({ version: 1, settings: { enseigne: null, store: null }, choices: [] }),
    beforeSave(draft) {
      // Un choix vidé (ni retenu ni secours) disparaît.
      draft.choices = draft.choices.filter((c) => c.preferred || c.fallback.length > 0);
    },
  });

  const find = (file: DriveFile, key: string, enseigne: Enseigne) => file.choices.find((c) => c.key === key && c.enseigne === enseigne);

  return {
    async settings() {
      return (await state.read()).settings;
    },

    async choices() {
      return (await state.read()).choices;
    },

    setSettings(settings) {
      return state.update((file) => (file.settings = settings));
    },

    choose({ key, label, product, role }, by) {
      return state.update(
        (file) => {
          let choice = find(file, key, product.enseigne);
          if (!choice) {
            if (file.choices.length >= DRIVE_LIMITS.choices) return null;
            choice = { key, enseigne: product.enseigne, label, preferred: null, fallback: [], updatedAt: '', updatedBy: by };
            file.choices.push(choice);
          }
          const others = choice.fallback.filter((p) => p.id !== product.id);
          if (role === 'preferred') {
            const previous = choice.preferred && choice.preferred.id !== product.id ? [choice.preferred] : [];
            choice.preferred = product;
            choice.fallback = [...previous, ...others].slice(0, DRIVE_LIMITS.fallback);
          } else {
            if (choice.preferred?.id === product.id) choice.preferred = null;
            choice.fallback = [...others, product].slice(-DRIVE_LIMITS.fallback);
          }
          Object.assign(choice, { label, updatedAt: clock().toISOString(), updatedBy: by });
          return structuredClone(choice);
        },
        (choice) => choice !== null,
      );
    },

    forget(key, enseigne, id, by) {
      return state.update(
        (file) => {
          const choice = find(file, key, enseigne);
          if (!choice) return false;
          if (id === null) {
            file.choices = file.choices.filter((c) => c !== choice);
            return true;
          }
          const before = Number(choice.preferred !== null) + choice.fallback.length;
          if (choice.preferred?.id === id) choice.preferred = null;
          choice.fallback = choice.fallback.filter((p) => p.id !== id);
          if (Number(choice.preferred !== null) + choice.fallback.length === before) return false;
          Object.assign(choice, { updatedAt: clock().toISOString(), updatedBy: by });
          return true;
        },
        (removed) => removed,
      );
    },
  };
}
