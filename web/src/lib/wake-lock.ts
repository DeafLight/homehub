// Verrou d'écran (Screen Wake Lock) qui ne fuit pas : rendu à la demande même si le navigateur l'accorde après coup,
// et redemandé quand la page redevient visible (le navigateur le rend de lui-même quand elle est cachée). Le
// navigateur et le document sont injectés pour les tests.

export type WakeLockSentinel = { release(): Promise<void> };
export type WakeLockNavigator = { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } };
export type VisibilityDocument = {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

export type ScreenWakeLock = {
  /** Garde l'écran allumé tant que `release` n'est pas appelé (si le navigateur le permet). */
  acquire(): void;
  /** Rend le verrou et cesse de le redemander. Sans effet si déjà rendu. */
  release(): void;
};

export function createWakeLock(nav: WakeLockNavigator = navigator as WakeLockNavigator, doc: VisibilityDocument = document): ScreenWakeLock {
  let wanted = false;
  let sentinel: WakeLockSentinel | null = null;
  let pending = false;

  const drop = (lock: WakeLockSentinel) => void lock.release().catch(() => {});

  function request() {
    if (!wanted || sentinel || pending || !nav.wakeLock || doc.visibilityState !== 'visible') return;
    pending = true;
    nav.wakeLock
      .request('screen')
      .then((lock) => {
        // Accordé après la sortie de la page : on le rend aussitôt.
        if (wanted) sentinel = lock;
        else drop(lock);
      })
      .catch(() => {})
      .finally(() => (pending = false));
  }

  function onVisibility() {
    if (doc.visibilityState !== 'visible') {
      sentinel = null; // le navigateur l'a rendu de lui-même
      return;
    }
    request();
  }

  return {
    acquire() {
      if (wanted) return;
      wanted = true;
      doc.addEventListener('visibilitychange', onVisibility);
      request();
    },
    release() {
      if (!wanted) return;
      wanted = false;
      doc.removeEventListener('visibilitychange', onVisibility);
      if (sentinel) drop(sentinel);
      sentinel = null;
    },
  };
}
