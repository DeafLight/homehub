// Routes de la caméra en direct. Le téléphone d'un parent (jamais la tablette, jamais un enfant) ouvre une diffusion,
// envoie son offre et ses candidats, attend la réponse ; la page de la tablette (reconnue comme telle) attend les
// demandes et répond. Chaque appel du téléphone revérifie qu'il est toujours celui d'un parent.
import type { Context } from 'hono';
import { z } from 'zod';
import type { Access } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import type { LiveCamera } from './services/live-camera.ts';

export const PARENTS_ONLY = 'La caméra en direct est réservée aux parents';
export const PHONE_ONLY = 'La caméra en direct se regarde depuis le téléphone d’un parent';

const SDP_MAX = 20_000;
const candidateSchema = z
  .object({
    candidate: z.string().max(1000),
    sdpMid: z.string().max(64).nullish(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullish(),
    usernameFragment: z.string().max(256).nullish(),
  })
  .nullable();
const byeSchema = z.object({ kind: z.literal('bye'), reason: z.string().trim().max(120).optional() });
const phoneSignalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('offer'), sdp: z.string().min(1).max(SDP_MAX) }),
  z.object({ kind: z.literal('candidate'), candidate: candidateSchema }),
  byeSchema,
]);
const tabletSignalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer'), sdp: z.string().min(1).max(SDP_MAX) }),
  z.object({ kind: z.literal('candidate'), candidate: candidateSchema }),
  byeSchema,
]);
/** Identifiant d'une page de la tablette (tiré au hasard par la page). */
const clientSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

const afterOf = (c: Context) => {
  const raw = c.req.query('after');
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fail(400, 'Paramètre after : entier positif');
};

export function createCameraApi({ camera, household, access }: { camera: LiveCamera; household: Household; access: Access }) {
  const api = createRouter();

  /** Le téléphone d'un parent : l'appareil (pour reconnaître ses diffusions) et le parent. */
  async function viewer(c: Context) {
    const author = await access.parent(c, PARENTS_ONLY);
    const who = await access.caller(c);
    if (!who.device || author.via !== 'phone' || author.ownerId === null) return fail(403, PHONE_ONLY);
    return { deviceId: who.device.id, viewerId: author.ownerId, viewerName: household.nameOf(author.ownerId) };
  }

  api.post('/camera/sessions', async (c) => c.json(camera.open(await viewer(c)), 201));

  api.post('/camera/sessions/:id/signal', async (c) => {
    const { deviceId } = await viewer(c);
    const signal = await readBody(c, phoneSignalSchema, 'Message de caméra inattendu');
    camera.phoneSignal(c.req.param('id'), deviceId, signal);
    return c.body(null, 204);
  });

  api.get('/camera/sessions/:id/signals', async (c) => {
    const { deviceId } = await viewer(c);
    return c.json(await camera.phoneMessages(c.req.param('id'), deviceId, afterOf(c) ?? 0, c.req.raw.signal));
  });

  api.delete('/camera/sessions/:id', async (c) => {
    const { deviceId } = await viewer(c);
    try {
      camera.phoneSignal(c.req.param('id'), deviceId, { kind: 'bye' });
    } catch {
      // Déjà terminée : rien à fermer.
    }
    return c.body(null, 204);
  });

  // Tablette : demandes de diffusion et messages des téléphones.
  api.get('/camera/tablet/signals', async (c) => {
    await access.kiosk(c);
    const client = clientSchema.safeParse(c.req.query('client'));
    if (!client.success) return fail(400, 'Paramètre client attendu');
    return c.json(await camera.tabletMessages(client.data, afterOf(c), c.req.raw.signal));
  });

  api.post('/camera/tablet/sessions/:id/signal', async (c) => {
    await access.kiosk(c);
    const client = clientSchema.safeParse(c.req.query('client'));
    if (!client.success) return fail(400, 'Paramètre client attendu');
    camera.tabletSignal(client.data, c.req.param('id'), await readBody(c, tabletSignalSchema, 'Message de caméra inattendu'));
    return c.body(null, 204);
  });

  return api;
}
