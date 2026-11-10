// Routes du programme de renforcement (onglet Sport du téléphone). Données personnelles : seul le téléphone du profil
// les lit et les modifie, ni la tablette, ni le téléphone d'un autre membre, même parent. Le profil doit avoir
// `fitness: true` dans homehub.yaml. Exception, la séance guidée de la tablette : la personne reconnue devant elle (et
// elle seule, pas un parent pour un autre) lit sa séance du jour, sans rien de personnel, et note la fin de séance.
import type { Context } from 'hono';
import { tabletSessionOf } from '../shared/fitness-workout.ts';
import { type Access, REJECTED_PHONE, WHO_ARE_YOU } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { type FitnessResult, type FitnessStore, rhythmInput, sessionInput, slotInput, tabletSessionInput, weekInput } from './sources/fitness.ts';

export function createFitnessApi({ fitness, household, access }: { fitness: FitnessStore; household: Household; access: Access }) {
  const api = createRouter();

  /** Le profil, s'il a un programme ; sinon 404. */
  const withProgram = (ownerId: string | null | undefined) => {
    const member = household.member(ownerId);
    return member?.fitness ? member.id : fail(404, 'Pas de programme sur ce profil');
  };

  /** Profil du téléphone qui appelle, s'il a un programme. */
  async function phoneOwner(c: Context): Promise<string> {
    const who = await access.caller(c);
    if (who.rejectedToken) return fail(401, REJECTED_PHONE);
    if (!who.device) return fail(403, 'Réservé au téléphone de la personne');
    return withProgram(who.device.ownerId);
  }

  /** Personne reconnue devant la tablette, si elle a un programme. */
  async function tabletOwner(c: Context): Promise<string> {
    const who = await access.kiosk(c);
    if (!who.actorId) return fail(403, WHO_ARE_YOU, true);
    return withProgram(who.actorId);
  }

  const reply = (result: FitnessResult) => ('error' in result ? fail(result.status, result.error) : result.state);

  api.get('/fitness', async (c) => c.json(fitness.get(await phoneOwner(c))));

  // Chaque lecture prolonge aussi la session de la personne reconnue : la séance guidée la relit pendant la séance.
  api.get('/fitness/tablet', async (c) => {
    const id = await tabletOwner(c);
    return c.json(tabletSessionOf(id, fitness.get(id)));
  });

  api.post('/fitness/tablet/sessions', async (c) => {
    const id = await tabletOwner(c);
    const input = await readBody(c, tabletSessionInput);
    await fitness.addSession(id, { ...input, note: null, exercises: [] });
    return c.json(tabletSessionOf(id, fitness.get(id)), 201);
  });

  api.post('/fitness/sessions', async (c) => {
    const id = await phoneOwner(c);
    return c.json(await fitness.addSession(id, await readBody(c, sessionInput)), 201);
  });

  api.delete('/fitness/sessions/:sessionId', async (c) => {
    const id = await phoneOwner(c);
    return c.json(reply(await fitness.removeSession(id, c.req.param('sessionId'))));
  });

  api.put('/fitness/weeks/:week', async (c) => {
    const id = await phoneOwner(c);
    return c.json(reply(await fitness.setWeek(id, c.req.param('week'), await readBody(c, weekInput))));
  });

  api.post('/fitness/rhythm', async (c) => {
    const id = await phoneOwner(c);
    const { week, option } = await readBody(c, rhythmInput);
    return c.json(reply(await fitness.chooseRhythm(id, week, option)));
  });

  api.post('/fitness/slots', async (c) => {
    const id = await phoneOwner(c);
    const { session, family, change } = await readBody(c, slotInput);
    return c.json(reply(await fitness.changeSlot(id, session, family, change)));
  });

  return api;
}
