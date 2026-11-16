// Routes de l'heure du coucher (fonction 16 de l'appli HomeHub TV) : réglages et coucher de ce soir lus par la tablette
// et les téléphones appairés ; réglages modifiés par un parent reconnu devant la tablette ; report, annulation et
// rétablissement de ce soir par un parent, depuis son téléphone ou la tablette ; « Essayer » le rappel (tablette).
import type { Access } from './access.ts';
import { createRouter, readBody } from './http.ts';
import { SCREENS_PARENTS_ONLY } from './screen-api.ts';
import type { Bedtime } from './services/bedtime.ts';
import { bedtimeSettingsInput } from './sources/bedtime.ts';

export const BEDTIME_PARENTS_ONLY = 'Le coucher des enfants se règle par un parent';

export function createBedtimeApi({ bedtime, access }: { bedtime: Bedtime; access: Access }) {
  const api = createRouter();

  api.get('/screens/bedtime', async (c) => {
    await access.trusted(c);
    return c.json(await bedtime.tonight());
  });

  api.put('/screens/bedtime', async (c) => {
    await access.kiosk(c);
    const settings = await readBody(c, bedtimeSettingsInput, 'Réglages attendus : { enabled, school, holidays, reminderMin, sleepMin }');
    const by = await access.parent(c, SCREENS_PARENTS_ONLY);
    return c.json(await bedtime.saveSettings(settings, by));
  });

  api.post('/screens/bedtime/postpone', async (c) => c.json(await bedtime.postpone(await access.parent(c, BEDTIME_PARENTS_ONLY))));
  api.post('/screens/bedtime/cancel', async (c) => c.json(await bedtime.cancel(await access.parent(c, BEDTIME_PARENTS_ONLY))));
  api.post('/screens/bedtime/restore', async (c) => c.json(await bedtime.restore(await access.parent(c, BEDTIME_PARENTS_ONLY))));

  api.post('/screens/bedtime/test', async (c) => {
    await access.kiosk(c);
    await access.parent(c, SCREENS_PARENTS_ONLY);
    return c.json(await bedtime.tryReminder());
  });

  return api;
}
