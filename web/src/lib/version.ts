// Surveille le serveur : recharge la page quand une nouvelle version est déployée,
// et signale si le serveur est joignable. Renvoie la fonction d'arrêt.
import type { Api } from './api.ts';

const RELOAD_GUARD_KEY = 'homehub:lastReload';
const RELOAD_MIN_INTERVAL_MS = 60_000;

export type VersionWatchOptions = {
  api: Api;
  currentVersion: string;
  intervalMs: number;
  onReachable(reachable: boolean): void;
  reload?: () => void;
};

export function watchVersion({ api, currentVersion, intervalMs, onReachable, reload = () => location.reload() }: VersionWatchOptions): () => void {
  async function check() {
    try {
      const health = await api.health();
      onReachable(true);
      if (health.version !== currentVersion && reloadAllowed()) reload();
    } catch {
      onReachable(false);
    }
  }

  void check();
  const timer = setInterval(check, intervalMs);
  return () => clearInterval(timer);
}

// Au plus un rechargement par minute, pour ne pas boucler si le rechargement renvoie encore l'ancien front.
function reloadAllowed(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_MIN_INTERVAL_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage indisponible : on recharge quand même.
  }
  return true;
}
