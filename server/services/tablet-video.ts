// Vidéo YouTube du téléphone vers la tablette, en mémoire seulement. La tablette attend la prochaine vidéo par
// interrogation longue, comme les demandes de la caméra en direct (pas de canal poussé : rien de plus à faire passer
// par le proxy). Seule la dernière vidéo compte : une nouvelle remplace la précédente. Une page de tablette qui
// démarre ne rejoue pas une vidéo déjà envoyée. Sans page de tablette à l'écoute, l'envoi est refusé (le téléphone le
// dit tout de suite au lieu d'attendre une lecture qui ne viendra pas).
import type { TabletVideo, TabletVideoReply, VideoShare } from '../../shared/video.ts';
import { fail } from '../http.ts';
import type { Clock } from '../sources/types.ts';

/** Attente d'une interrogation longue, sous le délai des proxys (60 s pour Nginx). */
export const VIDEO_WAIT_MS = 25_000;
/** Sans nouvelle interrogation pendant ce temps, la tablette est partie. */
export const VIDEO_GONE_MS = 40_000;
/** Une vidéo arrivée il y a plus longtemps n'est plus lancée (tablette revenue après une coupure). */
export const VIDEO_TTL_MS = 60_000;

export const VIDEO_TABLET_OFFLINE = 'Tablette injoignable : elle est peut-être éteinte ou sur une autre page qu’HomeHub';

export type TabletVideoChannel = ReturnType<typeof createTabletVideo>;

export function createTabletVideo({ clock, waitMs = VIDEO_WAIT_MS, goneMs = VIDEO_GONE_MS }: { clock: Clock; waitMs?: number; goneMs?: number }) {
  const now = () => clock().getTime();
  let seq = 0;
  let latest: (TabletVideo & { at: number }) | null = null;
  const waiters = new Set<() => void>();
  /** Interrogations de la tablette en cours, et la dernière vue. */
  let polling = 0;
  let seenAt = Number.NEGATIVE_INFINITY;

  const tabletOnline = () => polling > 0 || now() - seenAt < goneMs;

  function wait(ms: number, abort?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        abort?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      waiters.add(done);
      abort?.addEventListener('abort', done, { once: true });
    });
  }

  const fresh = (after: number) => (latest && latest.seq > after && now() - latest.at < VIDEO_TTL_MS ? latest : null);

  return {
    tabletOnline,

    /** Un téléphone envoie une vidéo (déjà validée) ; refusé si aucune page de tablette n'écoute. */
    send(video: VideoShare, from: string): { seq: number } {
      if (!tabletOnline()) fail(503, VIDEO_TABLET_OFFLINE);
      latest = { ...video, from, seq: ++seq, at: now() };
      for (const wake of waiters) wake();
      waiters.clear();
      return { seq };
    },

    /**
     * La tablette attend la vidéo suivante. `after` null : page qui démarre, réponse immédiate sans vidéo (rien n'est
     * rejoué), avec le numéro à reprendre.
     */
    async next(after: number | null, abort?: AbortSignal): Promise<TabletVideoReply> {
      polling++;
      seenAt = now();
      try {
        if (after === null) return { video: null, last: seq };
        // L'attente se compte en temps réel (l'horloge injectée sert à la présence et à l'âge des vidéos).
        const deadline = performance.now() + waitMs;
        while (!fresh(after) && !abort?.aborted && performance.now() < deadline) await wait(deadline - performance.now(), abort);
        const found = fresh(after);
        return { video: found && { videoId: found.videoId, start: found.start, from: found.from, seq: found.seq }, last: seq };
      } finally {
        polling--;
        seenAt = now();
      }
    },
  };
}
