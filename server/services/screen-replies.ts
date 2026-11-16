// Réponses rapides des télés (fonction 10), en mémoire seulement : un message écrit affiché sur une télé
// ouvre une attente de réponse, liée à son expéditeur et aux télés qui l'ont reçu. La télé répond « OK », « J'arrive »
// ou « 5 minutes » à la télécommande ; le téléphone de l'expéditeur attend par interrogation longue et l'affiche. Une
// réponse n'est acceptée que d'une télé qui a reçu le message, pendant REPLY_TTL_MS ; une par télé (la dernière fait
// foi). Personne d'autre que l'expéditeur ne lit les réponses.
import { randomUUID } from 'node:crypto';
import { QUICK_REPLY_LABELS, type QuickReply, type ScreenReplies, type ScreenReply } from '../../shared/screen.ts';
import { fail } from '../http.ts';
import type { Clock } from '../sources/types.ts';
import { WAIT_MS } from './live-camera.ts';

/** Une télé peut répondre pendant ce temps après l'envoi (le bandeau est parti bien avant). */
export const REPLY_TTL_MS = 10 * 60_000;
/** Attentes de réponse gardées au plus (les plus anciennes s'en vont). */
export const REPLY_MAX = 50;

export const REPLY_UNKNOWN = 'Message inconnu ou trop ancien';
export const REPLY_NOT_YOURS = 'Ce message n’est pas le tien';
export const REPLY_CLOSED = 'Trop tard pour répondre à ce message';

type Pending = {
  /** Expéditeur : celui qui peut lire les réponses (« phone:alex »). */
  author: string;
  /** Télés qui ont reçu le message : identifiant → nom. */
  screens: Map<string, string>;
  openedAt: number;
  replies: ScreenReply[];
  /** Nombre de réponses reçues (une réponse remplacée compte aussi) : le téléphone attend au-delà. */
  rev: number;
  waiters: Set<() => void>;
};

export type ScreenReplyBox = ReturnType<typeof createScreenReplies>;

export function createScreenReplies({ clock, waitMs = WAIT_MS, ttlMs = REPLY_TTL_MS }: { clock: Clock; waitMs?: number; ttlMs?: number }) {
  const pending = new Map<string, Pending>();
  const now = () => clock().getTime();
  const isOpen = (p: Pending) => now() - p.openedAt < ttlMs;

  const sweep = () => {
    for (const [id, p] of pending) if (!isOpen(p) && !p.waiters.size) pending.delete(id);
    while (pending.size > REPLY_MAX) pending.delete(pending.keys().next().value!);
  };

  return {
    /** Ouvre l'attente des réponses d'un message, avant de l'envoyer aux télés `screens` ; renvoie son identifiant. */
    open(author: string, screens: { id: string; name: string }[]): string {
      const id = randomUUID();
      pending.set(id, { author, screens: new Map(screens.map((s) => [s.id, s.name])), openedAt: now(), replies: [], rev: 0, waiters: new Set() });
      sweep();
      return id;
    },

    /** Les télés qui ont vraiment affiché le message : les autres ne pourront pas répondre ; aucune, l'attente s'efface. */
    keep(id: string, shown: string[]) {
      const p = pending.get(id);
      if (!p) return;
      for (const screen of [...p.screens.keys()]) if (!shown.includes(screen)) p.screens.delete(screen);
      if (!p.screens.size) pending.delete(id);
    },

    /** Réponse de la télé `screenId` ; 404 si le message est inconnu ou ne lui a pas été envoyé, 410 s'il est trop ancien. */
    answer(screenId: string, id: string, reply: QuickReply): ScreenReply {
      const p = pending.get(id);
      const name = p?.screens.get(screenId);
      if (!p || name === undefined) return fail(404, REPLY_UNKNOWN);
      if (!isOpen(p)) return fail(410, REPLY_CLOSED);
      const answered: ScreenReply = { reply, label: QUICK_REPLY_LABELS[reply], screen: name, at: clock().toISOString() };
      p.replies = [...p.replies.filter((r) => r.screen !== name), answered];
      p.rev++;
      for (const wake of p.waiters) wake();
      return answered;
    },

    /**
     * Réponses du message `id` pour son expéditeur, quand il y en a eu plus de `after` : tout de suite, ou dès la
     * suivante, ou au bout de `waitMs` (ou quand la télé ne peut plus répondre) ; 404 inconnu, 403 si ce n'est pas
     * l'expéditeur.
     */
    async wait(id: string, author: string, after: number, abort?: AbortSignal): Promise<ScreenReplies> {
      const p = pending.get(id) ?? fail(404, REPLY_UNKNOWN);
      if (p.author !== author) return fail(403, REPLY_NOT_YOURS);
      const fresh = () => p.rev > after;
      const deadline = performance.now() + waitMs;
      while (!fresh() && isOpen(p) && !abort?.aborted && performance.now() < deadline) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            p.waiters.delete(done);
            abort?.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, Math.max(0, Math.min(deadline - performance.now(), p.openedAt + ttlMs - now())));
          p.waiters.add(done);
          abort?.addEventListener('abort', done, { once: true });
        });
      }
      return { replies: p.replies, rev: p.rev, open: isOpen(p) };
    },
  };
}

/** Clé de l'expéditeur : son appareil (téléphone ou tablette) et son profil. */
export const replyAuthor = (author: { ownerId: string | null; via: string }) => `${author.via}:${author.ownerId ?? '?'}`;
