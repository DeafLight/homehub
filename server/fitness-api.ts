// Routes du programme de renforcement (onglet Sport du téléphone). Données personnelles : seul le téléphone du profil
// les lit et les modifie, ni la tablette, ni le téléphone d'un autre membre, même parent. Le profil doit avoir
// `fitness: true` dans homehub.yaml. Exception, la séance guidée de la tablette : la personne reconnue devant elle (et
// elle seule, pas un parent pour un autre) lit sa séance du jour, sans rien de personnel, et note la fin de séance.
import { type Context, Hono } from 'hono';
import type { z } from 'zod';
import type { Access } from './access.ts';
import { nextSession, PALIERS, planSession } from '../shared/fitness.ts';
import type { TabletSession } from '../shared/fitness-workout.ts';
import type { ConfigStore } from './config-store.ts';
import {
  type FitnessResult,
  type FitnessStore,
  rhythmInput,
  sessionInput,
  slotInput,
  tabletSessionInput,
  weekInput,
} from './sources/fitness.ts';

export function createFitnessApi({ fitness, config, access }: { fitness: FitnessStore; config: ConfigStore; access: Access }): Hono {
  const api = new Hono();

  /** Profil du téléphone qui appelle, s'il a un programme ; sinon la réponse d'erreur. */
  async function owner(c: Context): Promise<string | Response> {
    const who = await access.caller(c);
    if (who.rejectedToken) return c.json({ error: 'Téléphone non reconnu : à appairer de nouveau' }, 401);
    if (!who.device) return c.json({ error: 'Réservé au téléphone de la personne' }, 403);
    const member = config.current().members.find((m) => m.id === who.device?.ownerId);
    if (!member?.fitness) return c.json({ error: 'Pas de programme sur ce profil' }, 404);
    return member.id;
  }

  /** Personne reconnue devant la tablette, si elle a un programme ; sinon la réponse d'erreur. */
  async function tabletOwner(c: Context): Promise<string | Response> {
    const who = await access.caller(c);
    if (!who.kiosk) return c.json({ error: 'Réservé à la tablette de la maison' }, 403);
    if (!who.actorId) return c.json({ error: 'Qui es-tu ? Regarde la tablette pour être reconnu', identify: true }, 403);
    const member = config.current().members.find((m) => m.id === who.actorId);
    if (!member?.fitness) return c.json({ error: 'Pas de programme sur ce profil' }, 404);
    return member.id;
  }

  /** Séance du jour pour la tablette : numéro, rythme et exercices, rien d'autre. */
  function tabletSession(ownerId: string): TabletSession {
    const state = fitness.get(ownerId);
    const session = nextSession(state);
    return {
      ownerId,
      session,
      palier: state.palier,
      rounds: PALIERS[state.palier].rounds,
      effort: state.effort,
      rest: state.rest,
      exercises: planSession(state, session).map(({ family, exercise }) => ({ family, id: exercise.id })),
    };
  }

  const invalid = (c: Context, error: z.ZodError) => c.json({ error: error.issues[0]?.message ?? 'Format inattendu' }, 400);
  const reply = (c: Context, result: FitnessResult) => ('error' in result ? c.json({ error: result.error }, result.status) : c.json(result.state));
  const body = (c: Context) => c.req.json().catch(() => null);

  api.get('/fitness', async (c) => {
    const id = await owner(c);
    return typeof id === 'string' ? c.json(fitness.get(id)) : id;
  });

  // Chaque lecture prolonge aussi la session de la personne reconnue : la séance guidée la relit pendant la séance.
  api.get('/fitness/tablet', async (c) => {
    const id = await tabletOwner(c);
    return typeof id === 'string' ? c.json(tabletSession(id)) : id;
  });

  api.post('/fitness/tablet/sessions', async (c) => {
    const id = await tabletOwner(c);
    if (typeof id !== 'string') return id;
    const input = tabletSessionInput.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    await fitness.addSession(id, { ...input.data, note: null, exercises: [] });
    return c.json(tabletSession(id), 201);
  });

  api.post('/fitness/sessions', async (c) => {
    const id = await owner(c);
    if (typeof id !== 'string') return id;
    const input = sessionInput.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    return c.json(await fitness.addSession(id, input.data), 201);
  });

  api.delete('/fitness/sessions/:sessionId', async (c) => {
    const id = await owner(c);
    if (typeof id !== 'string') return id;
    return reply(c, await fitness.removeSession(id, c.req.param('sessionId')));
  });

  api.put('/fitness/weeks/:week', async (c) => {
    const id = await owner(c);
    if (typeof id !== 'string') return id;
    const input = weekInput.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    return reply(c, await fitness.setWeek(id, c.req.param('week'), input.data));
  });

  api.post('/fitness/rhythm', async (c) => {
    const id = await owner(c);
    if (typeof id !== 'string') return id;
    const input = rhythmInput.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    return reply(c, await fitness.chooseRhythm(id, input.data.week, input.data.option));
  });

  api.post('/fitness/slots', async (c) => {
    const id = await owner(c);
    if (typeof id !== 'string') return id;
    const input = slotInput.safeParse(await body(c));
    if (!input.success) return invalid(c, input.error);
    return reply(c, await fitness.changeSlot(id, input.data.session, input.data.family, input.data.change));
  });

  return api;
}
