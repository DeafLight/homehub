// Listes affichées par la tablette et le téléphone : chargées et rafraîchies, avec les actions qui les modifient.
// Les cases cochées changent tout de suite ; après chaque action on relit les listes (tâche suivante d'une tâche
// qui revient, ajout d'un autre appareil entre-temps).
import { FAMILY_ID, type Lists, type ListTask, type ShoppingItem } from '../../../shared/types.ts';
import { type Api, ApiError, type NewTask } from './api.ts';
import { createResource } from './resource.svelte.ts';

export type ListsState = {
  readonly data: Lists | null;
  readonly error: string | null;
  /** Dernière action refusée ou échouée, jusqu'à la suivante. */
  readonly actionError: string | null;
  refresh(): Promise<void>;
  addShopping(label: string): Promise<void>;
  setShoppingDone(item: ShoppingItem, done: boolean): Promise<void>;
  removeShopping(item: ShoppingItem): Promise<void>;
  clearShopping(): Promise<void>;
  addTask(task: NewTask): Promise<void>;
  setTaskDone(task: ListTask, done: boolean): Promise<void>;
  removeTask(task: ListTask): Promise<void>;
  destroy(): void;
};

/**
 * `guard` : sur la tablette, vérifie avant d'agir que la personne reconnue peut écrire sur ce profil (et la fait
 * reconnaître au besoin) ; false : l'action est abandonnée sans appel au serveur.
 */
export type ListsOptions = {
  refreshMs: number;
  guard?: (ownerId: string) => Promise<boolean>;
  onUnauthorized?: () => void;
};

export function createListsState(api: Api, { refreshMs, guard = async () => true, onUnauthorized }: ListsOptions): ListsState {
  const lists = createResource(() => api.lists(), refreshMs);
  let actionError = $state<string | null>(null);

  async function run(ownerId: string, action: () => Promise<unknown>, optimistic?: (data: Lists) => Lists) {
    actionError = null;
    if (!(await guard(ownerId))) return;
    if (optimistic && lists.data) lists.set(optimistic(lists.data));
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized?.();
      actionError = (err as Error).message;
      throw err;
    } finally {
      await lists.refresh();
    }
  }

  // Les erreurs sont affichées par `actionError` : les gestes simples (cocher, retirer) ne les remontent pas.
  const quiet = (promise: Promise<void>) => promise.catch(() => {});

  return {
    get data() {
      return lists.data;
    },
    get error() {
      return lists.error;
    },
    get actionError() {
      return actionError;
    },
    refresh: lists.refresh,
    addShopping: (label) => run(FAMILY_ID, () => api.addShopping(label)),
    setShoppingDone: (item, done) =>
      quiet(
        run(
          FAMILY_ID,
          () => api.setShoppingDone(item.id, done),
          (data) => ({ ...data, shopping: data.shopping.map((s) => (s.id === item.id ? { ...s, done } : s)) }),
        ),
      ),
    removeShopping: (item) =>
      quiet(
        run(
          FAMILY_ID,
          () => api.removeShopping(item.id),
          (data) => ({ ...data, shopping: data.shopping.filter((s) => s.id !== item.id) }),
        ),
      ),
    clearShopping: () =>
      quiet(
        run(
          FAMILY_ID,
          () => api.clearShopping(),
          (data) => ({ ...data, shopping: data.shopping.filter((s) => !s.done) }),
        ),
      ),
    addTask: (task) => run(task.ownerId, () => api.addTask(task)),
    setTaskDone: (task, done) =>
      quiet(
        run(
          task.ownerId,
          () => api.setListTaskDone(task.id, done),
          (data) => ({ ...data, tasks: data.tasks.map((t) => (t.id === task.id ? { ...t, done } : t)) }),
        ),
      ),
    removeTask: (task) =>
      quiet(
        run(
          task.ownerId,
          () => api.removeTask(task.id),
          (data) => ({ ...data, tasks: data.tasks.filter((t) => t.id !== task.id) }),
        ),
      ),
    destroy: lists.destroy,
  };
}
