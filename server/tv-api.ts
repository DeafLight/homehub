// Route du message à la télé : un parent (son téléphone, ou reconnu à la tablette, access.ts) envoie un court texte,
// nettoyé et limité ici (shared/tv.ts) quoi qu'ait fait le front. Une télé appairée avec l'appli HomeHub TV le reçoit
// en bandeau (événement `message`, chaque télé joignable rend compte de l'affichage) ; sans télé appairée, 404.
// Réponses rapides (fonction 10) : sous le message, la télé propose « OK », « J'arrive », « 5 minutes » ; elle envoie
// la réponse choisie (`POST /api/screen/replies/:id`, la télé seulement) et le téléphone de l'expéditeur l'attend
// (`GET /api/tv/replies/:id`, interrogation longue).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { cleanTvMessage, TV_MESSAGE_MAX, TV_SECONDS_DEFAULT, type TvMessageSent, tvTitle } from '../shared/tv.ts';
import type { Access } from './access.ts';
import type { ConfigStore } from './config-store.ts';
import type { Household } from './household.ts';
import { QUICK_REPLIES } from '../shared/screen.ts';
import { createRouter, fail, readBody } from './http.ts';
import { checkProtocol } from './screen-api.ts';
import { replyAuthor, type ScreenReplyBox } from './services/screen-replies.ts';
import { SCREEN_OFFLINE, type ScreenHub } from './services/screens.ts';
import type { ScreenStore } from './sources/screens.ts';

export const TV_PARENTS_ONLY = 'Le message à la télé est réservé aux parents';
export const TV_NONE = 'Aucune télé appairée : installez l’appli HomeHub TV sur la télé et appairez-la';
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
const replySchema = z.object({ reply: z.enum(QUICK_REPLIES) });
const replyIdSchema = z.string().uuid();

export function createTvApi({
  screens,
  hub,
  config,
  household,
  access,
  replies,
}: {
  screens: ScreenStore;
  hub: ScreenHub;
  config: ConfigStore;
  household: Household;
  access: Access;
  /** Réponses rapides des télés (fonction 10). */
  replies: ScreenReplyBox;
}) {
  const api = createRouter();

  api.post('/tv/message', async (c) => {
    const author = await access.parent(c, TV_PARENTS_ONLY);
    const { text } = await readBody(c, messageSchema);
    const from = author.ownerId === null ? null : household.nameOf(author.ownerId);
    const paired = await screens.list();
    if (!paired.length) return fail(404, TV_NONE);
    const seconds = config.current().tv?.seconds ?? TV_SECONDS_DEFAULT;
    const reachable = paired.filter((s) => hub.online(s.id));
    if (!reachable.length) return fail(503, SCREEN_OFFLINE);
    const title = tvTitle(from);
    const replyId = replies.open(replyAuthor(author), reachable);
    const reports = await Promise.all(
      reachable.map(async (s) => ({ id: s.id, name: s.name, report: await hub.send(s.id, { kind: 'message', id: randomUUID(), title, text, seconds, replyId }, MESSAGE_REPORT_MS) })),
    );
    const shown = reports.filter((r) => r.report.ok);
    replies.keep(replyId, shown.map((r) => r.id));
    if (!shown.length) {
      const failed = reports.map((r) => `${r.name} : ${r.report.ok ? '' : r.report.reason}`).join(' ; ');
      return fail(502, failed);
    }
    return c.json({ text, seconds, screens: shown.map((r) => r.name), replyId } satisfies TvMessageSent);
  });

  // Téléphone (ou tablette) de l'expéditeur : réponses de la télé à son message, par interrogation longue.
  api.get('/tv/replies/:id', async (c) => {
    const author = await access.parent(c, TV_PARENTS_ONLY);
    const id = replyIdSchema.safeParse(c.req.param('id'));
    if (!id.success) return fail(404, 'Message inconnu');
    const after = Number(c.req.query('after') ?? 0);
    if (!Number.isInteger(after) || after < 0) return fail(400, 'Paramètre after : entier positif');
    return c.json(await replies.wait(id.data, replyAuthor(author), after, c.req.raw.signal));
  });

  // La télé : réponse choisie à la télécommande sous un message qu'elle a affiché.
  api.post('/screen/replies/:id', async (c) => {
    checkProtocol(c);
    const screen = await access.screen(c);
    const id = replyIdSchema.safeParse(c.req.param('id'));
    if (!id.success) return fail(404, 'Message inconnu');
    const { reply } = await readBody(c, replySchema, 'Réponse attendue : { "reply": "ok" | "coming" | "five" }');
    return c.json(replies.answer(screen.id, id.data, reply));
  });

  return api;
}
