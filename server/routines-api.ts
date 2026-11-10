// Réglages des routines (page « Routines ») : lus par tous, modifiés par un parent seulement.
import { FAMILY_ID } from '../shared/types.ts';
import type { Access } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { settingsRefused } from './settings.ts';
import { type RoutinePlanStore, routineSettingsInput } from './sources/routine-plans.ts';

export function createRoutinesApi({ plans, household, access }: { plans: RoutinePlanStore; household: Household; access: Access }) {
  const api = createRouter();

  api.get('/routines', (c) => c.json(plans.current()));

  api.put('/routines', async (c) => {
    const settings = await readBody(c, routineSettingsInput, settingsRefused);
    const author = await access.parent(c, 'Seul un parent peut modifier les routines');
    const unknown = Object.keys(settings.members).find((id) => id === FAMILY_ID || !household.isMember(id));
    if (unknown) return fail(400, `Profil inconnu : ${unknown}`);
    return c.json(await plans.save(settings, author));
  });

  return api;
}
