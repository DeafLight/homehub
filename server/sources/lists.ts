// Listes de la famille (courses et tâches), enregistrées dans le dossier d'état (lists.json) : c'est la seule
// donnée que HomeHub produit lui-même. Les modifications passent une par une, et chacune est écrite sur le disque
// (fichier temporaire puis renommage) avant d'être confirmée.
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Author, Lists, ListTask, Repeat, ShoppingItem, Task } from '../../shared/types.ts';
import type { Clock, TaskSource } from './types.ts';

/** Une tâche faite reste affichée jusqu'à la fin du jour ; elle est oubliée au bout de ce délai. */
const DONE_TASKS_KEPT_DAYS = 30;
const FREQUENT_LIMIT = 8;
export const LABEL_MAX = 120;

const authorSchema = z.object({ ownerId: z.string().nullable(), via: z.enum(['tablet', 'phone']) });
const repeatSchema = z.object({ every: z.number().int().min(1).max(365), unit: z.enum(['day', 'week']) });

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
    }),
  ),
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

export type NewTask = { label: string; ownerId: string; due: string | null; repeat: Repeat | null };

export type ListsStore = {
  /** Ce qui est à faire, et les tâches faites aujourd'hui. */
  lists(): Promise<Lists>;
  addShopping(label: string, by: Author): Promise<ShoppingItem>;
  setShoppingDone(id: string, done: boolean, by: Author): Promise<ShoppingItem | null>;
  removeShopping(id: string): Promise<boolean>;
  /** Retire les articles cochés (« Vider le panier »). */
  clearShopping(): Promise<void>;
  addTask(task: NewTask, by: Author): Promise<ListTask>;
  setTaskDone(id: string, done: boolean, by: Author): Promise<ListTask | null>;
  removeTask(id: string): Promise<boolean>;
};

/** Jour local AAAA-MM-JJ. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
  let data: ListsFile | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<ListsFile> {
    if (data) return data;
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return (data = { version: 1, shopping: [], tasks: [], history: {} });
    }
    const parsed = fileSchema.safeParse(JSON.parse(text));
    // Jamais d'écrasement d'un fichier qu'on ne comprend pas : les listes restent en lecture seule (erreur 500).
    if (!parsed.success) throw new Error(`${path} illisible :\n${z.prettifyError(parsed.error)}`);
    return (data = parsed.data);
  }

  async function save(file: ListsFile) {
    const limit = clock().getTime() - DONE_TASKS_KEPT_DAYS * 86_400_000;
    file.tasks = file.tasks.filter((t) => !t.done || !t.doneAt || new Date(t.doneAt).getTime() > limit);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await rename(tmp, path);
  }

  /** Les modifications passent une par une : chacune lit l'état laissé par la précédente. */
  function change<T>(apply: (file: ListsFile, now: Date) => T): Promise<T> {
    const run = queue.then(async () => {
      const file = await load();
      const result = apply(file, clock());
      await save(file);
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    async lists() {
      await queue;
      const file = await load();
      const openLabels = new Set(file.shopping.map((s) => s.label.toLowerCase()));
      const frequent = Object.values(file.history)
        .filter((h) => !openLabels.has(h.label.toLowerCase()))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'))
        .slice(0, FREQUENT_LIMIT)
        .map((h) => h.label);
      return {
        shopping: [...file.shopping.filter((s) => !s.done), ...file.shopping.filter((s) => s.done)],
        tasks: visibleTasks(file.tasks, localDay(clock())),
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
        const before = file.shopping.length;
        file.shopping = file.shopping.filter((s) => s.id !== id);
        return file.shopping.length < before;
      });
    },

    clearShopping() {
      return change((file) => {
        file.shopping = file.shopping.filter((s) => !s.done);
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
      const item =
        ownerId === familyId ? await store.setShoppingDone(taskId, done, author) : await store.setTaskDone(taskId, done, author);
      return item && toTask(item);
    },
  };
}
