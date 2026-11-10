// Outils de la couche HTTP : refus sous forme d'exception (HttpError), traduits partout de la même façon en
// `{ error, identify? }` ; lecture du corps validée par zod. Les routes disent ce qu'elles exigent au lieu de recopier
// chaque test et chaque réponse d'erreur.
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

/** Refus d'une requête : statut, message pour l'écran, et `identify` quand la tablette doit d'abord reconnaître quelqu'un. */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly identify: boolean;

  constructor(status: ContentfulStatusCode, message: string, identify = false) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.identify = identify;
  }
}

/** Lève un refus (pour écrire `return fail(…)` ou `?? fail(…)`). */
export function fail(status: ContentfulStatusCode, message: string, identify = false): never {
  throw new HttpError(status, message, identify);
}

/** Premier problème relevé par zod, tel quel (« jour AAAA-MM-JJ »…). */
export const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? 'Format inattendu';

/**
 * Corps JSON validé par `schema` ; sinon un refus 400. `message` : texte fixe, ou tiré de l'erreur zod (par défaut,
 * son premier problème). Un corps absent ou qui n'est pas du JSON est traité comme `null`.
 */
export async function readBody<T>(c: Context, schema: z.ZodType<T>, message: string | ((error: z.ZodError) => string) = firstIssue): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return parsed.data;
  return fail(400, typeof message === 'string' ? message : message(parsed.error));
}

/** Réponse d'un refus : `{ error }`, plus `identify: true` s'il le faut. */
export const refusal = (c: Context, err: HttpError) =>
  c.json({ error: err.message, ...(err.identify && { identify: true }) }, err.status);

export type ErrorLogger = Pick<Console, 'error'>;

/** Gestionnaire d'erreurs commun : un refus devient sa réponse ; le reste, une erreur interne journalisée. */
export const handleErrors =
  (logger: ErrorLogger = console) =>
  (err: Error, c: Context) => {
    if (err instanceof HttpError) return refusal(c, err);
    logger.error(`${c.req.method} ${c.req.path} :`, err);
    return c.json({ error: 'Erreur interne' }, 500);
  };

/** Routeur Hono qui traduit les refus (utilisable seul, comme dans les tests, ou monté dans l'application). */
export function createRouter(logger?: ErrorLogger): Hono {
  const router = new Hono();
  router.onError(handleErrors(logger));
  return router;
}
