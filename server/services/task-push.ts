// Notification « Tâche en retard » sur le téléphone (Web Push) : une tâche à échéance est en retard le lendemain de son
// jour d'échéance si elle n'est pas cochée (même règle que « En retard » sur la tablette, web/src/lib/lists.ts). La
// notification part ce matin-là, à partir de TASK_LATE_HOUR (jamais en pleine nuit), vers les téléphones encore
// appairés du profil à qui la tâche est attribuée ; une tâche de la famille, vers les parents. Une seule fois par
// tâche et par échéance (clé gardée dans push.json) ; seules les tâches devenues en retard aujourd'hui sont annoncées
// (pas de rafale pour les vieilles tâches oubliées, ni au premier démarrage). Le texte de la tâche n'est envoyé qu'au
// téléphone de la personne, chiffré de bout en bout ; la tablette n'affiche rien. Touchée, elle ouvre les tâches.
import { localDay } from '../../shared/dates.ts';
import { FAMILY_ID, type ListTask } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import type { ListsStore } from '../sources/lists.ts';
import type { PushRecord, PushStore } from '../sources/push.ts';
import type { Clock } from '../sources/types.ts';
import type { PushMessage, PushResult } from './web-push.ts';

export const TASK_PUSH_TICK_MS = 60_000;
/** Heure locale à partir de laquelle on prévient, le matin où la tâche devient en retard. */
export const TASK_LATE_HOUR = 8;

/** Notification d'une tâche en retard : « Tâche en retard » (« … de la famille »), le texte de la tâche en corps. */
export function taskMessage(task: Pick<ListTask, 'id' | 'label' | 'ownerId'>): PushMessage {
  return {
    title: task.ownerId === FAMILY_ID ? 'Tâche de la famille en retard' : 'Tâche en retard',
    body: task.label,
    tag: `tache-${task.id}`,
    url: '/m/taches',
  };
}

/** Profils à prévenir : celui de la tâche ; une tâche de la famille, les parents. */
export function taskRecipients(task: Pick<ListTask, 'ownerId'>, members: { id: string; parent: boolean }[]): Set<string> {
  if (task.ownerId === FAMILY_ID) return new Set(members.filter((m) => m.parent).map((m) => m.id));
  return new Set(members.some((m) => m.id === task.ownerId) ? [task.ownerId] : []);
}

/** Tâches à annoncer à `now` : non cochées, échéance hier (en retard depuis ce matin), passé TASK_LATE_HOUR. */
export function lateTasks(tasks: ListTask[], now: Date): ListTask[] {
  if (now.getHours() < TASK_LATE_HOUR) return [];
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  return tasks.filter((t) => !t.done && t.due === yesterday);
}

export type TaskPushDeps = {
  lists: Pick<ListsStore, 'lists'>;
  store: Pick<PushStore, 'all' | 'unsubscribe' | 'markSent'>;
  /** Téléphones encore appairés (un abonnement d'un téléphone retiré est ignoré). */
  devices: () => Promise<{ id: string; ownerId: string }[]>;
  members: () => { id: string; parent: boolean }[];
  send: (subscription: PushRecord, message: PushMessage) => Promise<PushResult>;
  clock: Clock;
  logger: Logger;
};

export function createTaskPush({ lists, store, devices, members, send, clock, logger }: TaskPushDeps) {
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const late = lateTasks((await lists.lists()).tasks, clock());
      if (late.length === 0) return;
      const paired = new Map((await devices()).map((d) => [d.id, d.ownerId]));
      const subscriptions = (await store.all()).filter((s) => paired.get(s.deviceId) === s.ownerId && s.prefs.tasks);
      for (const task of late) {
        if (!(await store.markSent(`tache|${task.id}|${task.due}`))) continue;
        const to = taskRecipients(task, members());
        const message = taskMessage(task);
        for (const sub of subscriptions.filter((s) => to.has(s.ownerId))) {
          const result = await send(sub, message);
          if (result === 'gone') await store.unsubscribe(sub.deviceId);
          else if (result === 'failed') logger.error('Notification « Tâche en retard » non remise au service de push');
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start: () =>
      setInterval(() => void tick().catch((err: unknown) => logger.error(`Notifications des tâches en retard : ${(err as Error).message}`)), TASK_PUSH_TICK_MS).unref(),
  };
}
