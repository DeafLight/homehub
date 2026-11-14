// Alertes de la maison sur les télés (appli HomeHub TV). La tablette : lire le réglage, et le changer par un parent
// reconnu. La télé, avec son jeton : « Arrêter » sous l'alerte d'un minuteur arrête ce minuteur partout (tablette,
// téléphones, autres télés), comme le bouton de la tablette ; seulement un minuteur qui sonne.
import type { Context } from 'hono';
import { SCREEN_PROTOCOL, SCREEN_PROTOCOL_HEADER, type ScreenAlerts } from '../shared/screen.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { OUTDATED_APP, SCREENS_PARENTS_ONLY } from './screen-api.ts';
import { screenAlertsSchema, type ScreenAlertStore } from './sources/screen-alerts.ts';
import type { TimerStore } from './sources/timers.ts';
import type { Clock } from './sources/types.ts';

export const TIMER_NOT_RINGING = 'Ce minuteur ne sonne pas';

export function createScreenAlertsApi({ alerts, timers, access, clock }: { alerts: ScreenAlertStore; timers: TimerStore; access: Access; clock: Clock }) {
  const api = createRouter();

  api.get('/screens/alerts', async (c) => {
    await access.kiosk(c);
    return c.json((await alerts.get()) satisfies ScreenAlerts);
  });

  api.put('/screens/alerts', async (c) => {
    await access.kiosk(c);
    await access.parent(c, SCREENS_PARENTS_ONLY);
    const next = await readBody(c, screenAlertsSchema, 'Réglage attendu : { "timer": true } ou { "timer": false }');
    return c.json(await alerts.set(next));
  });

  api.post('/screen/timers/:id/stop', async (c: Context) => {
    if (c.req.header(SCREEN_PROTOCOL_HEADER) !== String(SCREEN_PROTOCOL)) fail(426, OUTDATED_APP);
    await access.screen(c);
    const timer = timers.list().find((t) => t.id === c.req.param('id'));
    // Déjà arrêté ailleurs : la télé n'a qu'à retirer son bandeau.
    if (!timer) return c.body(null, 204);
    if (new Date(timer.endsAt) > clock()) return fail(409, TIMER_NOT_RINGING);
    timers.stop(timer.id);
    return c.body(null, 204);
  });

  return api;
}
