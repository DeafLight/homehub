// Route du message à la télé : un parent (son téléphone, ou reconnu à la tablette, access.ts) envoie un court texte,
// nettoyé et limité ici (shared/tv.ts) quoi qu'ait fait le front. Une télé appairée avec l'appli HomeHub TV le reçoit
// en bandeau (événement `message`, chaque télé joignable rend compte de l'affichage) ; sans télé appairée, il part à
// l'appli tierce « Notifications for Android TV » (services/tv.ts, `tv.host`), retirée dans une prochaine version.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { cleanTvMessage, TV_MESSAGE_MAX, TV_SECONDS_DEFAULT, type TvMessageSent } from '../shared/tv.ts';
import type { Access } from './access.ts';
import type { ConfigStore } from './config-store.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { SCREEN_OFFLINE, type ScreenHub } from './services/screens.ts';
import { TvError, type TvNotifier, tvTitle } from './services/tv.ts';
import type { ScreenStore } from './sources/screens.ts';

export const TV_PARENTS_ONLY = 'Le message à la télé est réservé aux parents';
/** Attente du compte rendu d'une télé : le bandeau s'affiche tout de suite, sans rien télécharger. */
export const MESSAGE_REPORT_MS = 5_000;

const messageSchema = z.object({
  text: z
    .string()
    .max(2_000, 'Message trop long')
    .transform(cleanTvMessage)
    .refine((text) => text.length > 0, 'Message vide')
    .refine((text) => [...text].length <= TV_MESSAGE_MAX, `Message trop long (${TV_MESSAGE_MAX} caractères au plus)`),
});

export function createTvApi({
  tv,
  screens,
  hub,
  config,
  household,
  access,
}: {
  tv: TvNotifier;
  screens: ScreenStore;
  hub: ScreenHub;
  config: ConfigStore;
  household: Household;
  access: Access;
}) {
  const api = createRouter();

  api.post('/tv/message', async (c) => {
    const author = await access.parent(c, TV_PARENTS_ONLY);
    const { text } = await readBody(c, messageSchema);
    const from = author.ownerId === null ? null : household.nameOf(author.ownerId);
    const paired = await screens.list();
    if (paired.length) {
      const seconds = config.current().tv?.seconds ?? TV_SECONDS_DEFAULT;
      const reachable = paired.filter((s) => hub.online(s.id));
      if (!reachable.length) return fail(503, SCREEN_OFFLINE);
      const title = tvTitle(from);
      const reports = await Promise.all(
        reachable.map(async (s) => ({ name: s.name, report: await hub.send(s.id, { kind: 'message', id: randomUUID(), title, text, seconds }, MESSAGE_REPORT_MS) })),
      );
      const shown = reports.filter((r) => r.report.ok).map((r) => r.name);
      if (!shown.length) {
        const failed = reports.map((r) => `${r.name} : ${r.report.ok ? '' : r.report.reason}`).join(' ; ');
        return fail(502, failed);
      }
      return c.json({ text, seconds, screens: shown } satisfies TvMessageSent);
    }
    try {
      const seconds = await tv.send(text, from);
      return c.json({ text, seconds } satisfies TvMessageSent);
    } catch (err) {
      if (!(err instanceof TvError)) throw err;
      return fail(err.reason === 'off' ? 404 : 502, err.message);
    }
  });

  return api;
}
