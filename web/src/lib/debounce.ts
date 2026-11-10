// Attente de fin de frappe pour les champs de recherche : chaque fonction n'est lancée qu'après `delayMs` sans nouvel
// appel. `cancel` arrête tout ce qui attend encore (à la sortie de la page).

export type Debouncer = {
  /** Version retardée de `run` : chaque appel repousse le précédent. */
  wrap(run: () => void): () => void;
  cancel(): void;
};

export function createDebouncer(delayMs: number): Debouncer {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    wrap(run) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return () => {
        if (timer) (clearTimeout(timer), timers.delete(timer));
        timer = setTimeout(() => {
          timers.delete(timer!);
          run();
        }, delayMs);
        timers.add(timer);
      };
    },
    cancel() {
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}
