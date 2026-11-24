// « +1 min » sur un minuteur qui sonne en mode cuisine : chaque toucher ajoute une minute à un compteur en attente
// (« −1 min » en retire une) ; rien ne repart tant qu'on touche : la relance n'a lieu que SNOOZE_DELAY_MS après le
// dernier toucher, avec le total. Revenu à 0, plus rien n'attend (le minuteur reste terminé). Horloge injectable.

/** Attente après le dernier toucher avant de relancer. */
export const SNOOZE_DELAY_MS = 5_000;
/** Pas plus d'une heure d'un coup (le serveur accepte plus, mais à coups d'une minute…). */
export const SNOOZE_MAX_MINUTES = 60;

export type SnoozeState = {
  /** Minutes en attente (0 : rien à relancer). */
  minutes: number;
  /** Heure (ms) de la relance prévue ; null : rien n'attend. */
  dueAt: number | null;
};

export type Snoozer = {
  readonly state: SnoozeState;
  add(): void;
  remove(): void;
  /** Oublie ce qui attend, sans relancer (« Arrêter », sortie de l'écran). */
  cancel(): void;
};

type Handle = ReturnType<typeof setTimeout>;

export type SnoozerOptions = {
  /** Relance avec le total, SNOOZE_DELAY_MS après le dernier toucher. */
  onCommit: (minutes: number) => void;
  /** À chaque changement du compteur ou de l'attente. */
  onChange?: (state: SnoozeState) => void;
  delayMs?: number;
  now?: () => number;
  schedule?: (run: () => void, ms: number) => Handle;
  unschedule?: (handle: Handle) => void;
};

export function createSnoozer({
  onCommit,
  onChange = () => {},
  delayMs = SNOOZE_DELAY_MS,
  now = Date.now,
  schedule = setTimeout,
  unschedule = clearTimeout,
}: SnoozerOptions): Snoozer {
  let state: SnoozeState = { minutes: 0, dueAt: null };
  let handle: Handle | undefined;

  function set(minutes: number) {
    if (handle !== undefined) unschedule(handle);
    handle = undefined;
    if (minutes > 0) {
      handle = schedule(() => {
        handle = undefined;
        const total = state.minutes;
        state = { minutes: 0, dueAt: null };
        onChange(state);
        onCommit(total);
      }, delayMs);
    }
    state = { minutes, dueAt: minutes > 0 ? now() + delayMs : null };
    onChange(state);
  }

  return {
    get state() {
      return state;
    },
    add: () => set(Math.min(SNOOZE_MAX_MINUTES, state.minutes + 1)),
    remove: () => set(Math.max(0, state.minutes - 1)),
    cancel: () => set(0),
  };
}

/** Secondes avant la relance, arrondies au-dessus (« dans 5 s ») ; 0 : rien n'attend. */
export const secondsBeforeRelaunch = (state: SnoozeState, now: number) =>
  state.dueAt === null ? 0 : Math.max(0, Math.ceil((state.dueAt - now) / 1000));
