// Page « Vacances scolaires » : réglage du calendrier (académie, zone ou rien). Lu par la tablette et les téléphones
// appairés, modifié par un parent seulement. Magasin absent (tests) : page indisponible.
import type { Access } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import { settingsRefused } from './settings.ts';
import { type HolidaySettingsStore, holidaySettingsInput } from './sources/holiday-settings.ts';

export function createHolidaysApi({ holidaySettings, access }: { holidaySettings?: HolidaySettingsStore; access: Access }) {
  const api = createRouter();
  const store = () => holidaySettings ?? fail(404, 'Réglage des vacances indisponible');

  api.get('/school/holidays/settings', async (c) => {
    const settings = store();
    await access.trusted(c);
    return c.json(settings.current());
  });

  api.put('/school/holidays/settings', async (c) => {
    const settings = store();
    const input = await readBody(c, holidaySettingsInput, settingsRefused);
    const author = await access.parent(c, 'Seul un parent peut régler les vacances scolaires');
    return c.json(await settings.save(input, author));
  });

  return api;
}
