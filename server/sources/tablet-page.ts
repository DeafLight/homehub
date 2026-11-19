// Dernier chargement de la page de la tablette (page « Le NAS ») : la tablette le signale au démarrage de sa page,
// avec le motif (rechargement de la nuit, ou autre : version, démarrage de Fully Kiosk…). Gardé dans le dossier d'état
// pour survivre au redémarrage du serveur, qui ne recharge pas forcément la tablette.
import { z } from 'zod';
import type { TabletPage } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import type { Clock } from './types.ts';

/** Avance tolérée de l'horloge de la tablette sur celle du serveur ; au-delà, l'heure du serveur fait foi. */
export const TABLET_CLOCK_TOLERANCE_MS = 60_000;

const tabletPageSchema = z.object({ loadedAt: z.iso.datetime({ offset: true }), nightly: z.boolean() });
const fileSchema = z.object({ page: tabletPageSchema.nullable() });

export type TabletPageInput = { loadedAt: Date; nightly: boolean };

export type TabletPageStore = {
  /** Dernier chargement signalé, null : jamais. */
  read(): Promise<TabletPage | null>;
  /** Note un chargement ; un signalement plus ancien que celui déjà noté (réessai en retard) est ignoré. */
  record(input: TabletPageInput): Promise<TabletPage>;
};

export function createTabletPageStore({ path, clock }: { path: string; clock: Clock }): TabletPageStore {
  const file = createJsonFile({ path, schema: fileSchema, initial: () => ({ page: null }) });
  return {
    async read() {
      return (await file.read()).page;
    },
    record({ loadedAt, nightly }) {
      const now = clock().getTime();
      const at = loadedAt.getTime() > now + TABLET_CLOCK_TOLERANCE_MS ? now : loadedAt.getTime();
      const page: TabletPage = { loadedAt: new Date(at).toISOString(), nightly };
      return file.update(
        (draft) => {
          if (draft.page && new Date(draft.page.loadedAt).getTime() > at) return draft.page;
          draft.page = page;
          return page;
        },
        (result) => result === page,
      );
    },
  };
}
