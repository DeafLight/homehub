// Visages : enregistrés depuis la tablette avec le code parent (personne n'est encore reconnu au premier
// enregistrement), puis reconnus pour savoir qui écrit sur la tablette. Tablette seule. Une série de prises
// anormalement uniforme (tablette qui calcule mal les empreintes) est refusée.
import { z } from 'zod';
import { looksUniform, UNIFORM_MESSAGE } from '../shared/faces.ts';
import { type Access, ACTOR_HEADER } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { type PinGate, pinInBody } from './pin-gate.ts';
import type { FaceRecognition } from './services/faces.ts';
import { type ActorSessions, embeddingSchema, type FaceStore, MAX_SAMPLES } from './sources/faces.ts';

const score = z.number().min(0).max(1);
const readingSchema = z.object({ embedding: embeddingSchema, real: score, live: score });
const enrollSchema = z.object({ embeddings: z.array(embeddingSchema).min(1).max(MAX_SAMPLES), pin: z.string().max(20).optional() });

export type FacesApiDeps = {
  household: Household;
  faces: FaceStore;
  recognition: FaceRecognition;
  sessions: ActorSessions;
  pins: PinGate;
  access: Access;
};

export function createFacesApi({ household, faces, recognition, sessions, pins, access }: FacesApiDeps) {
  const api = createRouter();

  api.get('/faces', async (c) => {
    await access.kiosk(c);
    return c.json({ enrolled: await faces.enrolled(), samples: await faces.counts() });
  });

  /**
   * La tablette envoie, environ une fois par seconde, l'empreinte du visage qu'elle voit. Reconnu : une session,
   * présentée ensuite dans l'en-tête X-Actor-Session ; la même, prolongée, tant que c'est la même personne.
   */
  api.post('/faces/identify', async (c) => {
    await access.kiosk(c);
    const reading = await readBody(c, readingSchema, 'Empreinte de visage attendue');
    const { ok, ...result } = await recognition.identify(reading, c.req.header(ACTOR_HEADER));
    if (ok) return c.json(result);
    return fail(401, 'far' in result && result.far ? 'Visage non reconnu : approche-toi de la tablette' : 'Visage non reconnu');
  });

  /** Diagnostic (page Visages) : verdict et ressemblance avec chaque personne ; n'ouvre aucune session. */
  api.post('/faces/diagnose', async (c) => {
    await access.kiosk(c);
    return c.json(await recognition.diagnose(await readBody(c, readingSchema, 'Empreinte de visage attendue')));
  });

  api.delete('/faces/session', (c) => {
    sessions.close(c.req.header(ACTOR_HEADER));
    return c.body(null, 204);
  });

  api.post('/faces/:ownerId', async (c) => {
    await access.kiosk(c);
    const ownerId = c.req.param('ownerId');
    if (!household.isMember(ownerId)) return fail(400, 'Profil inconnu');
    const input = await readBody(c, enrollSchema, 'Empreintes de visage attendues');
    await pins.parent(input.pin);
    // Prises presque identiques : la tablette calcule mal, elles casseraient la reconnaissance de tout le monde.
    if (looksUniform(input.embeddings)) return fail(422, UNIFORM_MESSAGE);
    await faces.enroll(ownerId, input.embeddings);
    return c.body(null, 204);
  });

  api.delete('/faces/:ownerId', async (c) => {
    await access.kiosk(c);
    await pins.parent(await pinInBody(c));
    return (await faces.remove(c.req.param('ownerId'))) ? c.body(null, 204) : fail(404, 'Visage inconnu');
  });

  return api;
}
