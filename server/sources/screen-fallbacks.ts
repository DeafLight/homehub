// Appareil de secours de chaque télé appairée (réglage de la tablette, section Télés) : l'appareil Cast (Google Home)
// qui lit un message vocal destiné à la télé quand elle est éteinte ou injoignable. Gardé dans screen-fallbacks.json
// (dossier d'état) : identifiant d'un appareil de `cast.devices`, ou null pour « aucun ». Une télé jamais réglée
// n'a pas d'entrée : la première enceinte de la liste s'applique (voir services/screen-fallback.ts).
import { z } from 'zod';
import { createJsonFile } from './json-file.ts';

const fileSchema = z.object({
  version: z.literal(1),
  screens: z.record(z.string(), z.string().max(32).nullable()),
});
type FallbackFile = z.infer<typeof fileSchema>;

export type ScreenFallbackStore = {
  /** Choix enregistrés, par télé : identifiant d'appareil Cast, ou null (aucun). Absente : jamais réglée. */
  all(): Promise<Record<string, string | null>>;
  set(id: string, device: string | null): Promise<void>;
  /** Télé retirée : son réglage est oublié. */
  remove(id: string): Promise<void>;
};

export function createScreenFallbackStore({ path }: { path: string }): ScreenFallbackStore {
  const state = createJsonFile<FallbackFile>({ path, schema: fileSchema, initial: () => ({ version: 1, screens: {} }) });
  return {
    async all() {
      return { ...(await state.read()).screens };
    },

    async set(id, device) {
      await state.update((file) => {
        file.screens[id] = device;
      });
    },

    async remove(id) {
      await state.update(
        (file) => {
          const had = id in file.screens;
          delete file.screens[id];
          return had;
        },
        (had) => had,
      );
    },
  };
}
