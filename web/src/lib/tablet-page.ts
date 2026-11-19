// Chargement de la page de la tablette, signalé au serveur au démarrage (page « Le NAS », pour suivre le rechargement
// de la nuit) : l'heure de chargement de la page et son motif (rechargement de la nuit ou non). Si le serveur ne répond
// pas encore (il redémarre : nouvelle version), on réessaie un moment, avec la même heure de chargement. Renvoie la
// fonction d'arrêt.
import type { TabletPage } from '../../../shared/types.ts';

export const REPORT_RETRY_MS = 30_000;
export const REPORT_ATTEMPTS = 20;

export type TabletPageReport = {
  send(page: TabletPage): Promise<unknown>;
  /** Chargement de la page (ms). */
  loadedAt: number;
  nightly: boolean;
  retryMs?: number;
  attempts?: number;
};

export function reportTabletPage({ send, loadedAt, nightly, retryMs = REPORT_RETRY_MS, attempts = REPORT_ATTEMPTS }: TabletPageReport): () => void {
  const page: TabletPage = { loadedAt: new Date(loadedAt).toISOString(), nightly };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const attempt = (left: number) => {
    send(page).catch(() => {
      if (!stopped && left > 1) timer = setTimeout(() => attempt(left - 1), retryMs);
    });
  };
  attempt(attempts);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** Heure de chargement du document (ms), celle du navigateur. */
export const documentLoadedAt = () => Math.round(globalThis.performance?.timeOrigin ?? Date.now());
