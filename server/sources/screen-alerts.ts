// Réglage des alertes de la maison sur les télés (panneau Télés de la tablette) : minuteur terminé, mode film
// automatique (fonction 15 : une appli de films au premier plan rend les annonces discrètes), enceinte Cast qui sonne à
// la fin d'un minuteur (0.103.0). Enregistré dans le dossier d'état (screen-alerts.json) ; sans fichier, toutes les alertes sont actives. Sans
// chemin (tests) : en mémoire seulement.
import { z } from 'zod';
import type { ScreenAlerts } from '../../shared/screen.ts';
import { createJsonFile } from './json-file.ts';

export const DEFAULT_SCREEN_ALERTS: ScreenAlerts = { timer: true, film: true, timerCast: null };

/**
 * Réglage reçu de la tablette (comme dans le fichier) ; `film` absent (fichier ou tablette d'avant la 15) : actif ;
 * `timerCast` absent (d'avant 0.103.0) : aucune enceinte.
 */
export const screenAlertsSchema = z.object({
  timer: z.boolean(),
  film: z.boolean().default(true),
  timerCast: z.string().regex(/^[a-z0-9-]{1,32}$/).nullable().default(null),
});
const fileSchema = z.object({ version: z.literal(1), alerts: screenAlertsSchema });

export type ScreenAlertStore = {
  get(): Promise<ScreenAlerts>;
  set(alerts: ScreenAlerts): Promise<ScreenAlerts>;
};

export function createScreenAlertStore({ path }: { path?: string } = {}): ScreenAlertStore {
  if (!path) {
    let alerts = { ...DEFAULT_SCREEN_ALERTS };
    return {
      get: async () => ({ ...alerts }),
      set: async (next) => ({ ...(alerts = { ...next }) }),
    };
  }
  const file = createJsonFile({ path, schema: fileSchema, initial: () => ({ version: 1 as const, alerts: { ...DEFAULT_SCREEN_ALERTS } }), pretty: true });
  return {
    get: async () => ({ ...(await file.read()).alerts }),
    async set(alerts) {
      await file.replace({ version: 1, alerts: { ...alerts } });
      return { ...alerts };
    },
  };
}
