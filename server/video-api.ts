// Routes de la vidéo YouTube envoyée à la tablette : tout téléphone appairé l'envoie (access.videoSender, enfant
// compris), seule la tablette l'attend (access.kiosk). Ne passent que l'identifiant de vidéo validé (11 caractères)
// et l'instant de départ : jamais une adresse, la tablette compose elle-même celle du lecteur YouTube.
import type { Context } from 'hono';
import { z } from 'zod';
import { VIDEO_START_MAX, YOUTUBE_ID } from '../shared/video.ts';
import type { Access } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import type { TabletVideoChannel } from './services/tablet-video.ts';

const shareSchema = z
  .object({
    videoId: z.string().regex(YOUTUBE_ID),
    start: z.number().int().min(0).max(VIDEO_START_MAX).default(0),
  })
  .strict();

const afterOf = (c: Context) => {
  const raw = c.req.query('after');
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fail(400, 'Paramètre after : entier positif');
};

export function createVideoApi({ channel, household, access }: { channel: TabletVideoChannel; household: Household; access: Access }) {
  const api = createRouter();

  api.post('/video/tablet', async (c) => {
    const sender = await access.videoSender(c);
    const video = await readBody(c, shareSchema, 'Vidéo attendue : { "videoId": "<11 caractères>", "start": <secondes> }');
    return c.json(channel.send(video, household.nameOf(sender.ownerId)), 202);
  });

  api.get('/video/tablet/next', async (c) => {
    await access.kiosk(c);
    return c.json(await channel.next(afterOf(c), c.req.raw.signal));
  });

  return api;
}
