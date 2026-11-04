// Minuteurs de la maison, partagés par la tablette : la liste (rafraîchie par Timers.svelte), et la fenêtre qui en
// lance un (ouverte depuis l'accueil ou le rail). Lancer ou arrêter un minuteur en cours demande quelqu'un de
// reconnu ; arrêter un minuteur qui sonne, non (n'importe qui doit pouvoir le faire taire).
import type { Timer } from '../../../shared/types.ts';
import type { Api } from './api.ts';

export type Timers = {
  readonly list: Timer[];
  /** Fenêtre « Minuteur » ouverte. */
  dialog: boolean;
  refresh(): Promise<void>;
  start(label: string, seconds: number): Promise<boolean>;
  stop(id: string): Promise<void>;
};

export function createTimers(
  api: Pick<Api, 'timers' | 'startTimer' | 'stopTimer'>,
  /** Quelqu'un de reconnu (attend au besoin) : voir Actor.allow. */
  allow: () => Promise<boolean>,
): Timers {
  let list = $state<Timer[]>([]);
  let dialog = $state(false);

  async function refresh() {
    try {
      list = await api.timers();
    } catch {
      // serveur injoignable : la dernière liste reste affichée
    }
  }

  return {
    get list() {
      return list;
    },
    get dialog() {
      return dialog;
    },
    set dialog(value) {
      dialog = value;
    },
    refresh,

    async start(label, seconds) {
      if (!(await allow())) return false;
      try {
        await api.startTimer(label, seconds);
        return true;
      } catch {
        return false;
      } finally {
        await refresh();
      }
    },

    async stop(id) {
      const timer = list.find((t) => t.id === id);
      if (timer && new Date(timer.endsAt).getTime() > Date.now() && !(await allow())) return;
      list = list.filter((t) => t.id !== id); // tout de suite : la sonnerie s'arrête
      try {
        await api.stopTimer(id);
      } finally {
        await refresh();
      }
    },
  };
}
