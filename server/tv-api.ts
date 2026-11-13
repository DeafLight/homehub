// Route du message à la télé : un parent (son téléphone, ou reconnu à la tablette) envoie un court texte, nettoyé et
// limité ici (shared/tv.ts) quoi qu'ait fait le front, puis transmis à la télé Android TV (services/tv.ts).
import { z } from 'zod';
import { cleanTvMessage, TV_MESSAGE_MAX, type TvMessageSent } from '../shared/tv.ts';
import type { Access } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { TvError, type TvNotifier } from './services/tv.ts';

export const TV_PARENTS_ONLY = 'Le message à la télé est réservé aux parents';

const messageSchema = z.object({
  text: z
    .string()
    .max(2_000, 'Message trop long')
    .transform(cleanTvMessage)
    .refine((text) => text.length > 0, 'Message vide')
    .refine((text) => [...text].length <= TV_MESSAGE_MAX, `Message trop long (${TV_MESSAGE_MAX} caractères au plus)`),
});

export function createTvApi({ tv, household, access }: { tv: TvNotifier; household: Household; access: Access }) {
  const api = createRouter();

  api.post('/tv/message', async (c) => {
    const author = await access.parent(c, TV_PARENTS_ONLY);
    const { text } = await readBody(c, messageSchema);
    try {
      const seconds = await tv.send(text, author.ownerId === null ? null : household.nameOf(author.ownerId));
      return c.json({ text, seconds } satisfies TvMessageSent);
    } catch (err) {
      if (!(err instanceof TvError)) throw err;
      return fail(err.reason === 'off' ? 404 : 502, err.message);
    }
  });

  return api;
}
