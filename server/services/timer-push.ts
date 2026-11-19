// Notification « Minuteur » sur le téléphone (Web Push) : dès qu'un minuteur de la maison arrive à zéro, les téléphones
// encore appairés de la personne qui l'a lancé la reçoivent (un minuteur sans auteur connu : les parents), s'ils n'ont
// pas coupé « Minuteurs » dans leurs réglages. Les minuteurs vivent sur le serveur (sources/timers.ts, début et fin
// gardés dans timers.json) : la notification part même tablette éteinte, et une seule fois par minuteur (clé gardée
// dans push.json, même après un redémarrage). Un minuteur arrêté avant la fin n'envoie rien. Touchée, elle ouvre
// l'accueil du téléphone (le minuteur s'arrête sur la tablette, ou d'un toucher sur une télé).
import type { Timer } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import type { PushRecord, PushStore } from '../sources/push.ts';
import type { TimerStore } from '../sources/timers.ts';
import type { Clock } from '../sources/types.ts';
import { timerAlertText } from './timer-alerts.ts';
import type { PushMessage, PushResult } from './web-push.ts';

/** Vérification des minuteurs : la notification part au plus quelques secondes après la fin. */
export const TIMER_PUSH_TICK_MS = 2_000;

/** Notification d'un minuteur qui sonne : son nom, « C'est l'heure ! (10 min) » comme sur la tablette et les télés. */
export function timerMessage(timer: Pick<Timer, 'id' | 'label' | 'durationSeconds'>): PushMessage {
  const { title, subtitle } = timerAlertText(timer);
  return { title, body: subtitle, tag: `minuteur-${timer.id}`, url: '/m' };
}

/** Profils à prévenir : celui qui a lancé le minuteur, s'il est un membre ; sinon les parents. */
export function timerRecipients(timer: Pick<Timer, 'startedBy'>, members: { id: string; parent: boolean }[]): Set<string> {
  const owner = members.find((m) => m.id === timer.startedBy.ownerId);
  return new Set(owner ? [owner.id] : members.filter((m) => m.parent).map((m) => m.id));
}

export type TimerPushDeps = {
  timers: Pick<TimerStore, 'list'>;
  store: Pick<PushStore, 'all' | 'unsubscribe' | 'markSent'>;
  /** Téléphones encore appairés (un abonnement d'un téléphone retiré est ignoré). */
  devices: () => Promise<{ id: string; ownerId: string }[]>;
  members: () => { id: string; parent: boolean }[];
  send: (subscription: PushRecord, message: PushMessage) => Promise<PushResult>;
  clock: Clock;
  logger: Logger;
};

export function createTimerPush({ timers, store, devices, members, send, clock, logger }: TimerPushDeps) {
  /** Minuteurs déjà traités par ce processus : pas de lecture de push.json à chaque tour pour eux. */
  const handled = new Set<string>();
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const now = clock().getTime();
      const listed = timers.list();
      for (const id of handled) if (!listed.some((t) => t.id === id)) handled.delete(id);
      const ringing = listed.filter((t) => Date.parse(t.endsAt) <= now && !handled.has(t.id));
      if (ringing.length === 0) return;
      const paired = new Map((await devices()).map((d) => [d.id, d.ownerId]));
      const subscriptions = (await store.all()).filter((s) => paired.get(s.deviceId) === s.ownerId && s.prefs.timers);
      for (const timer of ringing) {
        handled.add(timer.id);
        if (!(await store.markSent(`minuteur|${timer.id}`))) continue;
        const to = timerRecipients(timer, members());
        const message = timerMessage(timer);
        for (const sub of subscriptions.filter((s) => to.has(s.ownerId))) {
          const result = await send(sub, message);
          if (result === 'gone') await store.unsubscribe(sub.deviceId);
          else if (result === 'failed') logger.error('Notification « Minuteur » non remise au service de push');
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start: () =>
      setInterval(() => void tick().catch((err: unknown) => logger.error(`Notifications des minuteurs : ${(err as Error).message}`)), TIMER_PUSH_TICK_MS).unref(),
  };
}
