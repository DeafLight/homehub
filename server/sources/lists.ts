// Listes de la famille (courses et tâches), enregistrées dans le dossier d'état (lists.json) : c'est la seule
// donnée que HomeHub produit lui-même. Les modifications passent une par une, et chacune est écrite sur le disque
// (fichier temporaire puis renommage) avant d'être confirmée.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { localDay } from '../../shared/dates.ts';
import { UNITS } from '../../shared/ingredients.ts';
import { type SyncOps, weekOf } from '../../shared/menu.ts';
import type { Author, Lists, ListTask, NewTask, Repeat, ShoppingItem, ShoppingMenuMark, Task } from '../../shared/types.ts';
import { createJsonFile } from './json-file.ts';
import { authorSchema, sameShape } from './schemas.ts';
import type { Clock, TaskSource } from './types.ts';

/** Une tâche faite reste affichée jusqu'à la fin du jour ; elle est oubliée au bout de ce délai. */
const DONE_TASKS_KEPT_DAYS = 30;
const FREQUENT_LIMIT = 8;
export const LABEL_MAX = 120;

const repeatSchema = z.object({ every: z.number().int().min(1).max(365), unit: z.enum(['day', 'week']) });
const menuMarkSchema = z.object({
  week: z.string(),
  key: z.string(),
  quantities: z.partialRecord(z.string(), z.number()),
  toTaste: z.boolean(),
  aisle: z.string().nullable(),
  sources: z.array(z.string()),
  check: z.boolean().optional(),
  packs: z.object({ count: z.number().int().min(1), per: z.object({ quantity: z.number().positive(), unit: z.enum(UNITS) }) }).optional(),
});
sameShape<z.infer<typeof menuMarkSchema>, ShoppingMenuMark>(true);

const fileSchema = z.object({
  version: z.literal(1),
  shopping: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      done: z.boolean(),
      addedBy: authorSchema,
      addedAt: z.string(),
      doneBy: authorSchema.optional(),
      doneAt: z.string().optional(),
      menu: menuMarkSchema.optional(),
    }),
  ),
  /** Lignes du menu vidées du panier : achetées pour leur semaine (elles ne reviennent pas sur la liste). */
  cleared: z.array(menuMarkSchema).default([]),
  tasks: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      ownerId: z.string(),
      due: z.string().nullable(),
      repeat: repeatSchema.nullable(),
      done: z.boolean(),
      addedBy: authorSchema,
      addedAt: z.string(),
      doneBy: authorSchema.optional(),
      doneAt: z.string().optional(),
      /** Tâche suivante créée en cochant une tâche qui revient : retirée si on la décoche. */
      nextId: z.string().optional(),
    }),
  ),
  /** Articles déjà achetés, pour proposer les plus fréquents. Clé : libellé en minuscules. */
  history: z.record(z.string(), z.object({ label: z.string(), count: z.number() })),
});

type ListsFile = z.infer<typeof fileSchema>;
type StoredTask = ListsFile['tasks'][number];

export type ListsStore = {
  /** Ce qui est à faire, et les tâches faites aujourd'hui. */
  lists(): Promise<Lists>;
  addShopping(label: string, by: Author): Promise<ShoppingItem>;
  setShoppingDone(id: string, done: boolean, by: Author): Promise<ShoppingItem | null>;
  /** L'article retiré, ou null s'il n'existait pas. */
  removeShopping(id: string): Promise<ShoppingItem | null>;
  /** Retire les articles cochés (« Vider le panier ») ; les lignes du menu restent comptées comme achetées. */
  clearShopping(): Promise<void>;
  /**
   * Fait suivre le menu à la liste : `plan` reçoit les articles et les lignes du menu déjà vidées du panier, et
   * renvoie ce qu'il faut changer (shared/menu.ts, syncOps), appliqué dans la même écriture. Renvoie le nombre de
   * changements.
   */
  /** Lignes du menu vidées du panier, encore comptées comme achetées pour leur semaine. */
  cleared(): Promise<ShoppingMenuMark[]>;
  syncMenu(plan: (shopping: readonly ShoppingItem[], cleared: readonly ShoppingMenuMark[]) => SyncOps, by: Author): Promise<number>;
  addTask(task: NewTask, by: Author): Promise<ListTask>;
  setTaskDone(id: string, done: boolean, by: Author): Promise<ListTask | null>;
  removeTask(id: string): Promise<boolean>;
};

function addToDay(day: string, { every, unit }: Repeat): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + every * (unit === 'week' ? 7 : 1)));
}

/** Prochaine échéance d'une tâche qui revient, faite `today` : la première après aujourd'hui. */
export function nextDue(due: string | null, repeat: Repeat, today: string): string {
  let next = addToDay(due ?? today, repeat);
  while (next <= today) next = addToDay(next, repeat);
  return next;
}

const publicTask = ({ nextId: _nextId, ...task }: StoredTask): ListTask => task;

/** Tâches à faire (par échéance, sans date à la fin), puis celles faites aujourd'hui. */
function visibleTasks(tasks: StoredTask[], today: string): ListTask[] {
  const open = tasks
    .filter((t) => !t.done)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.addedAt.localeCompare(b.addedAt));
  const doneToday = tasks
    .filter((t) => t.done && t.doneAt && localDay(new Date(t.doneAt)) === today)
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  return [...open, ...doneToday].map(publicTask);
}

export function createListsStore({ path, clock }: { path: string; clock: Clock }): ListsStore {
  // Jamais d'écrasement d'un fichier qu'on ne comprend pas : les listes restent en lecture seule (erreur 500).
  const state = createJsonFile<ListsFile>({
    path,
    schema: fileSchema,
    initial: () => ({ version: 1, shopping: [], cleared: [], tasks: [], history: {} }),
    beforeSave(draft) {
      const limit = clock().getTime() - DONE_TASKS_KEPT_DAYS * 86_400_000;
      draft.tasks = draft.tasks.filter((t) => !t.done || !t.doneAt || new Date(t.doneAt).getTime() > limit);
      // Achats d'une semaine passée : plus rien à décompter.
      const week = weekOf(clock());
      draft.cleared = draft.cleared.filter((m) => m.week >= week);
    },
  });

  /** Les modifications passent une par une : chacune lit l'état laissé par la précédente. */
  const change = <T>(apply: (file: ListsFile, now: Date) => T): Promise<T> => state.update((draft) => apply(draft, clock()));

  return {
    async lists() {
      const { shopping, tasks, history } = await state.read();
      const openLabels = new Set(shopping.map((s) => s.label.toLowerCase()));
      const frequent = Object.values(history)
        .filter((h) => !openLabels.has(h.label.toLowerCase()))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'))
        .slice(0, FREQUENT_LIMIT)
        .map((h) => h.label);
      return {
        shopping: [...shopping.filter((s) => !s.done), ...shopping.filter((s) => s.done)],
        tasks: visibleTasks(tasks, localDay(clock())),
        frequent,
      };
    },

    addShopping(label, by) {
      return change((file, now) => {
        // Déjà sur la liste (même libellé, majuscules ignorées) : pas de doublon.
        const existing = file.shopping.find((s) => !s.done && s.label.toLowerCase() === label.toLowerCase());
        if (existing) return existing;
        const item: ShoppingItem = { id: randomUUID(), label, done: false, addedBy: by, addedAt: now.toISOString() };
        file.shopping.push(item);
        const key = label.toLowerCase();
        file.history[key] = { label, count: (file.history[key]?.count ?? 0) + 1 };
        return item;
      });
    },

    setShoppingDone(id, done, by) {
      return change((file, now) => {
        const item = file.shopping.find((s) => s.id === id);
        if (!item) return null;
        Object.assign(item, done ? { done, doneBy: by, doneAt: now.toISOString() } : { done, doneBy: undefined, doneAt: undefined });
        return item;
      });
    },

    removeShopping(id) {
      return change((file) => {
        const item = file.shopping.find((s) => s.id === id) ?? null;
        file.shopping = file.shopping.filter((s) => s.id !== id);
        if (item?.done && item.menu) file.cleared.push(item.menu);
        return item;
      });
    },

    clearShopping() {
      return change((file) => {
        for (const item of file.shopping) if (item.done && item.menu) file.cleared.push(item.menu);
        file.shopping = file.shopping.filter((s) => !s.done);
      });
    },

    async cleared() {
      const week = weekOf(clock());
      return (await state.read()).cleared.filter((m) => m.week >= week);
    },

    async syncMenu(plan, by) {
      // Rien à écrire quand la liste suit déjà le menu (cas le plus courant).
      const current = await state.read();
      const preview = plan(current.shopping, current.cleared);
      if (preview.add.length + preview.update.length + preview.remove.length === 0) return 0;
      return change((file, now) => {
        const ops = plan(file.shopping, file.cleared);
        const removed = new Set(ops.remove);
        file.shopping = file.shopping.filter((s) => !removed.has(s.id));
        for (const { id, label, menu } of ops.update) {
          const item = file.shopping.find((s) => s.id === id);
          if (item) Object.assign(item, { label, menu });
        }
        for (const { label, menu } of ops.add) {
          file.shopping.push({ id: randomUUID(), label, done: false, addedBy: by, addedAt: now.toISOString(), menu });
        }
        return ops.add.length + ops.update.length + ops.remove.length;
      });
    },

    addTask({ label, ownerId, due, repeat }, by) {
      return change((file, now) => {
        const task: StoredTask = { id: randomUUID(), label, ownerId, due, repeat, done: false, addedBy: by, addedAt: now.toISOString() };
        file.tasks.push(task);
        return publicTask(task);
      });
    },

    setTaskDone(id, done, by) {
      return change((file, now) => {
        const task = file.tasks.find((t) => t.id === id);
        if (!task) return null;
        if (done && !task.done) {
          Object.assign(task, { done, doneBy: by, doneAt: now.toISOString() });
          if (task.repeat) {
            const next: StoredTask = {
              ...task,
              id: randomUUID(),
              due: nextDue(task.due, task.repeat, localDay(now)),
              done: false,
              doneBy: undefined,
              doneAt: undefined,
              nextId: undefined,
            };
            file.tasks.push(next);
            task.nextId = next.id;
          }
        } else if (!done && task.done) {
          // Cochée par erreur : la tâche suivante, si personne ne l'a encore faite, disparaît.
          file.tasks = file.tasks.filter((t) => t.id !== task.nextId || t.done);
          Object.assign(task, { done, doneBy: undefined, doneAt: undefined, nextId: undefined });
        }
        return publicTask(task);
      });
    },

    removeTask(id) {
      return change((file) => {
        const before = file.tasks.length;
        file.tasks = file.tasks.filter((t) => t.id !== id);
        return file.tasks.length < before;
      });
    },
  };
}

const toTask = ({ id, label, done }: { id: string; label: string; done: boolean }): Task => ({ id, label, done });

/** Les listes vues par les dashboards : les tâches d'un membre, ou la liste de courses pour la famille. */
export function listsTaskSource(store: ListsStore, familyId: string): TaskSource {
  return {
    async tasksFor(ownerId) {
      const { shopping, tasks } = await store.lists();
      return ownerId === familyId ? shopping.map(toTask) : tasks.filter((t) => t.ownerId === ownerId).map(toTask);
    },
    async setDone(ownerId, taskId, done, by) {
      const author = by ?? { ownerId: null, via: 'tablet' };
      if (ownerId === familyId) return (await store.setShoppingDone(taskId, done, author).then((item) => item && toTask(item)));
      // Seulement une tâche de ce profil : le droit d'écrire a été vérifié sur lui, pas sur le profil de la tâche.
      const { tasks } = await store.lists();
      if (!tasks.some((t) => t.id === taskId && t.ownerId === ownerId)) return null;
      const item = await store.setTaskDone(taskId, done, author);
      return item && toTask(item);
    },
  };
}
