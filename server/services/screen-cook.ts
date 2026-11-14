// Mode cuisine d'une recette sur les télés (fonction 13), en mémoire seulement : pour chaque télé, la recette, l'étape
// en cours et qui l'a lancé (auteur des minuteurs lancés depuis la télécommande). L'étape avance depuis la télé, le
// téléphone ou la tablette ; la vue cuisine de la télé attend les changements (`wait`) : réveillée tout de suite par un
// changement d'étape, sinon au bout de `waitMs` au plus, pour reprendre aussi les minuteurs lancés ailleurs.
import type { ScreenCookSession } from '../../shared/screen-cook.ts';
import { clampStep } from '../../shared/screen-cook.ts';
import type { Author } from '../../shared/types.ts';

/** Attente au plus de la vue cuisine de la télé : les minuteurs lancés ailleurs y paraissent en quelques secondes. */
export const COOK_WAIT_MS = 5_000;

export type ScreenCookEntry = ScreenCookSession & { by: Author };

export type ScreenCooking = ReturnType<typeof createScreenCooking>;

export function createScreenCooking({ waitMs = COOK_WAIT_MS }: { waitMs?: number } = {}) {
  const sessions = new Map<string, ScreenCookEntry>();
  const waiters = new Map<string, Set<() => void>>();
  /** Numéro de révision commun : un nouveau mode cuisine ne reprend jamais le numéro d'un ancien. */
  let rev = 0;

  const wake = (screenId: string) => {
    for (const done of waiters.get(screenId) ?? []) done();
    waiters.delete(screenId);
  };

  return {
    get: (screenId: string): ScreenCookEntry | null => sessions.get(screenId) ?? null,

    /** Lance (ou relance) le mode cuisine de `recipeId` sur la télé, à l'étape `index`. */
    start(screenId: string, recipeId: string, index: number, by: Author): ScreenCookEntry {
      const entry = { recipeId, index: Math.max(0, Math.trunc(index)), rev: ++rev, by };
      sessions.set(screenId, entry);
      wake(screenId);
      return entry;
    },

    /** Va à l'étape `index` (ramenée entre la première et la dernière des `total`) ; null sans mode cuisine. */
    step(screenId: string, index: number, total: number): ScreenCookEntry | null {
      const entry = sessions.get(screenId);
      if (!entry) return null;
      const next = clampStep(index, total);
      if (next !== entry.index) {
        entry.index = next;
        entry.rev = ++rev;
        wake(screenId);
      }
      return entry;
    },

    /** Fin du mode cuisine ; false s'il n'y en avait pas. */
    stop(screenId: string): boolean {
      const had = sessions.delete(screenId);
      if (had) {
        rev++;
        wake(screenId);
      }
      return had;
    },

    /**
     * Attend que le mode cuisine de la télé change (autre étape, autre recette, fin) par rapport à la révision `after`,
     * au plus `waitMs` ; tout de suite si c'est déjà le cas.
     */
    async wait(screenId: string, after: number | null, abort?: AbortSignal): Promise<void> {
      const current = sessions.get(screenId)?.rev ?? null;
      if (after === null || current !== after) return;
      await new Promise<void>((resolve) => {
        const set = waiters.get(screenId) ?? new Set();
        waiters.set(screenId, set);
        const done = () => {
          clearTimeout(timer);
          set.delete(done);
          abort?.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        set.add(done);
        abort?.addEventListener('abort', done, { once: true });
      });
    },
  };
}
