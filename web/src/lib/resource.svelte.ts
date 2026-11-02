// Donnée chargée depuis l'API et rafraîchie périodiquement.
// En cas d'erreur, la dernière donnée reçue reste affichée.

export type Resource<T> = {
  readonly data: T | null;
  readonly error: string | null;
  refresh(): Promise<void>;
  /** Remplace la donnée localement (mise à jour optimiste). */
  set(value: T): void;
  destroy(): void;
};

export function createResource<T>(load: () => Promise<T>, refreshMs: number): Resource<T> {
  let data = $state<T | null>(null);
  let error = $state<string | null>(null);

  async function refresh() {
    try {
      data = await load();
      error = null;
    } catch (err) {
      error = (err as Error).message;
    }
  }

  void refresh();
  const timer = setInterval(refresh, refreshMs);

  return {
    get data() {
      return data;
    },
    get error() {
      return error;
    },
    refresh,
    set(value) {
      data = value;
    },
    destroy() {
      clearInterval(timer);
    },
  };
}
