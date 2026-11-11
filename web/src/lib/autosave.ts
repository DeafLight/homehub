// Enregistrement automatique des pages de réglages (Routines, Transports, Vacances) : chaque modification repousse
// l'enregistrement de `delayMs` (on finit de taper, on enchaîne les clics), puis la page enregistre tout son
// brouillon. L'état (en attente, en cours, enregistré, problème) est rattaché à la « zone » touchée en dernier (une
// carte, un choix) : SaveStatus.svelte l'affiche à côté de ce qu'on vient de modifier, pas en bas de page.

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'pending'; zone: string }
  | { kind: 'saving'; zone: string }
  | { kind: 'saved'; zone: string }
  | { kind: 'problem'; zone: string; text: string };

export type AutoSaveDeps = {
  /**
   * Enregistre le brouillon de la page. `false` : rien à enregistrer (pas de changement, choix incomplet).
   * Lève une erreur dont le message s'affiche (refus, serveur injoignable).
   */
  save(): Promise<boolean>;
  /** Problème du brouillon qui empêche d'enregistrer (étape sans nom…), ou null. */
  problem?: () => string | null;
  onState(state: SaveState): void;
  delayMs?: number;
  /** Durée d'affichage de « Enregistré ». */
  savedMs?: number;
  timers?: { set(run: () => void, ms: number): unknown; clear(id: unknown): void };
};

export type AutoSave = {
  /** Une modification dans `zone` : enregistrement dans `delayMs`, sauf nouvelle modification d'ici là. */
  touch(zone: string): void;
  /** Avertissement sans enregistrement (« 4 arrêts au plus »), affiché dans `zone`. */
  warn(zone: string, text: string): void;
  /** Enregistre tout de suite ce qui attend encore (sortie de la page). */
  flush(): Promise<void>;
  /** Oublie l'état affiché (brouillon remis à ce qui est enregistré). */
  reset(): void;
  /** Arrête les minuteries (sortie de la page, sans enregistrer). */
  cancel(): void;
};

export const AUTOSAVE_DELAY_MS = 800;
export const SAVED_SHOWN_MS = 3000;

export function createAutoSave({ save, problem, onState, delayMs = AUTOSAVE_DELAY_MS, savedMs = SAVED_SHOWN_MS, timers }: AutoSaveDeps): AutoSave {
  const set = timers?.set ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clear = timers?.clear ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let zone = '';
  let wait: unknown = null;
  let fade: unknown = null;
  let running: Promise<void> | null = null;
  /** Une modification est arrivée pendant l'enregistrement : on enregistre à nouveau ensuite. */
  let again = false;

  const stopTimers = () => {
    if (wait !== null) clear(wait);
    if (fade !== null) clear(fade);
    wait = fade = null;
  };

  async function run(): Promise<void> {
    wait = null;
    if (running) {
      again = true;
      return running;
    }
    const where = zone;
    const issue = problem?.() ?? null;
    if (issue) return void onState({ kind: 'problem', zone: where, text: issue });
    onState({ kind: 'saving', zone: where });
    running = (async () => {
      try {
        const done = await save();
        // Une modification attend déjà (ou suit) : son état « en attente » reste affiché.
        if (again || wait !== null) return;
        if (!done) return void onState({ kind: 'idle' });
        onState({ kind: 'saved', zone: where });
        fade = set(() => ((fade = null), onState({ kind: 'idle' })), savedMs);
      } catch (err) {
        if (!again && wait === null) onState({ kind: 'problem', zone: where, text: err instanceof Error ? err.message : String(err) });
      }
    })();
    await running;
    running = null;
    if (again) {
      again = false;
      await run();
    }
  }

  return {
    touch(where) {
      zone = where;
      stopTimers();
      onState({ kind: 'pending', zone: where });
      wait = set(() => void run(), delayMs);
    },
    warn(where, text) {
      if (fade !== null) clear(fade);
      fade = null;
      onState({ kind: 'problem', zone: where, text });
    },
    async flush() {
      if (wait === null) return running ?? undefined;
      clear(wait);
      await run();
    },
    reset() {
      stopTimers();
      onState({ kind: 'idle' });
    },
    cancel: stopTimers,
  };
}

/** Ce qu'il faut de la personne devant la tablette pour enregistrer un réglage (voir actor.svelte.ts). */
export type SaveActor = {
  allow(ownerId: string | null): Promise<boolean>;
  isKiosk(): Promise<boolean>;
  readonly current: { parent?: boolean } | null;
};

/**
 * Sur la tablette, seul un parent reconnu enregistre (le serveur le vérifie aussi) : attend sa reconnaissance,
 * sinon lève l'erreur affichée à côté de la modification.
 */
export async function requireParent(actor: SaveActor, refusal: string): Promise<void> {
  if (!(await actor.allow(null))) throw new Error('Pas enregistré : regarde la tablette');
  if ((await actor.isKiosk()) && !actor.current?.parent) throw new Error(refusal);
}
