// Réponses rapides de la télé (fonction 10) au téléphone de l'expéditeur : après un message écrit ou vocal affiché sur
// la télé, le téléphone attend par interrogation longue (GET /api/tv/replies/:id) « OK », « J'arrive » ou
// « 5 minutes », choisie à la télécommande, et la montre à côté du compte rendu. L'attente cesse quand la télé ne peut
// plus répondre, quand le message est oublié du serveur, ou quand l'écran la coupe ; une coupure réseau est réessayée.
import type { ScreenReplies, ScreenReply } from '../../../shared/screen.ts';
import { ApiError } from './api.ts';

export type RepliesApi = { tvReplies(id: string, after: number, abort?: AbortSignal): Promise<ScreenReplies> };

/** Pause avant de réessayer après une erreur réseau, et nombre d'erreurs de suite avant d'abandonner. */
export const REPLIES_RETRY_MS = 3_000;
export const REPLIES_MAX_ERRORS = 5;

/** Suit les réponses du message `replyId` ; `onReplies` à chaque nouvelle réponse. Renvoie de quoi arrêter. */
export function watchReplies({
  api,
  replyId,
  onReplies,
  retryMs = REPLIES_RETRY_MS,
}: {
  api: RepliesApi;
  replyId: string;
  onReplies: (replies: ScreenReply[]) => void;
  retryMs?: number;
}): () => void {
  const abort = new AbortController();
  void (async () => {
    let after = 0;
    let errors = 0;
    while (!abort.signal.aborted) {
      try {
        const found = await api.tvReplies(replyId, after, abort.signal);
        errors = 0;
        if (abort.signal.aborted) return;
        if (found.rev > after) onReplies(found.replies);
        after = found.rev;
        if (!found.open) return;
      } catch (err) {
        // Message inconnu (serveur redémarré, trop ancien) ou refus : plus rien à attendre.
        if (abort.signal.aborted || (err instanceof ApiError && err.status >= 400 && err.status < 500)) return;
        if (++errors >= REPLIES_MAX_ERRORS) return;
        await new Promise((resolve) => setTimeout(resolve, retryMs));
      }
    }
  })();
  return () => abort.abort();
}
