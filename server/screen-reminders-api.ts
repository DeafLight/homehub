// Routes des rappels sur la télé (fonction 5 de l'appli HomeHub TV) : réglages lus par la tablette, modifiés par un
// parent reconnu devant elle, et « Essayer » qui envoie un rappel tout de suite aux télés allumées.
import { z } from 'zod';
import { SCREEN_REMINDER_KINDS } from '../shared/screen-reminders.ts';
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { SCREENS_PARENTS_ONLY } from './screen-api.ts';
import type { ScreenReminders } from './services/screen-reminders.ts';
import { type ScreenReminderStore, screenRemindersInput } from './sources/screen-reminders.ts';
import type { Clock } from './sources/types.ts';

const kindSchema = z.enum(SCREEN_REMINDER_KINDS);

export function createScreenRemindersApi({ store, reminders, access, clock }: { store: ScreenReminderStore; reminders: ScreenReminders; access: Access; clock: Clock }) {
  const api = createRouter();

  api.get('/screens/reminders', async (c) => {
    await access.kiosk(c);
    return c.json(await store.current());
  });

  api.put('/screens/reminders', async (c) => {
    await access.kiosk(c);
    const input = await readBody(c, screenRemindersInput, 'Réglages attendus : { reminders: [{ kind, enabled, time }] }');
    const by = await access.parent(c, SCREENS_PARENTS_ONLY);
    return c.json(await store.save(input, by, clock()));
  });

  api.post('/screens/reminders/:kind/test', async (c) => {
    await access.kiosk(c);
    await access.parent(c, SCREENS_PARENTS_ONLY);
    const kind = kindSchema.safeParse(c.req.param('kind'));
    if (!kind.success) return fail(404, 'Rappel inconnu');
    return c.json(await reminders.sendNow(kind.data));
  });

  return api;
}
