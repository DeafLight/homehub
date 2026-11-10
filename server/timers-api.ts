// Minuteurs de la maison : à personne en particulier ; en lancer un demande d'être reconnu (tablette) ou un téléphone
// appairé. Un minuteur qui sonne s'arrête depuis n'importe quel appareil de la maison.
import { z } from 'zod';
import { type Access, READ_ONLY_DEVICE } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { MAX_TIMERS, TIMER_LABEL_MAX, TIMER_MAX_SECONDS, type TimerStore } from './sources/timers.ts';
import type { Clock } from './sources/types.ts';

const timerSchema = z.object({
  label: z.string().trim().max(TIMER_LABEL_MAX).default(''),
  seconds: z.number().int().min(10).max(TIMER_MAX_SECONDS),
});

export function createTimersApi({ timers, access, clock }: { timers: TimerStore; access: Access; clock: Clock }) {
  const api = createRouter();

  api.get('/timers', (c) => c.json(timers.list()));

  api.post('/timers', async (c) => {
    const { label, seconds } = await readBody(c, timerSchema, `Durée attendue : de 10 s à ${TIMER_MAX_SECONDS / 3600} h`);
    const author = await access.writer(c, null);
    return c.json(timers.start(label, seconds, author) ?? fail(409, `${MAX_TIMERS} minuteurs au plus`), 201);
  });

  /** Arrêter un minuteur qui sonne : n'importe qui à la tablette (ou un téléphone) ; en cours : quelqu'un de reconnu. */
  api.delete('/timers/:id', async (c) => {
    const timer = timers.list().find((t) => t.id === c.req.param('id')) ?? fail(404, 'Minuteur inconnu');
    if (new Date(timer.endsAt) <= clock()) {
      const caller = await access.caller(c);
      if (!caller.kiosk && !caller.device) return fail(403, READ_ONLY_DEVICE);
    } else {
      await access.writer(c, null);
    }
    timers.stop(timer.id);
    return c.body(null, 204);
  });

  return api;
}
