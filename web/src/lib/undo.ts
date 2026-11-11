// Geste qu'on peut annuler quelques secondes : l'action n'est faite qu'au bout du délai, sauf « Annuler ». Un seul
// geste en attente à la fois : en commencer un autre fait aussitôt le précédent ; quitter la page aussi (`flush`).
// Sans navigateur (minuteries injectables) : testé à côté.

export const UNDO_DELAY_MS = 6_000;

export type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type Undoable<T> = {
  /** Ce qui attend, ou null. */
  readonly pending: T | null;
  /** Met `item` en attente ; un geste déjà en attente est fait tout de suite. */
  start(item: T): void;
  /** « Annuler » : rend l'élément en attente (null s'il n'y en avait plus). */
  cancel(): T | null;
  /** Fait tout de suite le geste en attente (départ de la page). */
  flush(): void;
};

/**
 * `commit` fait l'action (appel au serveur) ; `onChange` prévient l'affichage quand l'attente change.
 */
export function createUndoable<T>(commit: (item: T) => void, onChange: (pending: T | null) => void = () => {}, delayMs = UNDO_DELAY_MS, timers: Timers = browserTimers): Undoable<T> {
  let pending: T | null = null;
  let handle: unknown = null;

  function take(): T | null {
    const item = pending;
    if (handle !== null) timers.clear(handle);
    pending = null;
    handle = null;
    if (item !== null) onChange(null);
    return item;
  }

  function flush() {
    const item = take();
    if (item !== null) commit(item);
  }

  return {
    get pending() {
      return pending;
    },
    start(item) {
      flush();
      pending = item;
      handle = timers.set(flush, delayMs);
      onChange(item);
    },
    cancel: take,
    flush,
  };
}
