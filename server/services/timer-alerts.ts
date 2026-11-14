// Alerte des minuteurs sur les télés (fonction 3 de l'appli HomeHub TV) : un guetteur regarde chaque seconde les
// minuteurs de la maison. Dès qu'un minuteur se termine, chaque télé allumée reçoit un événement `timer` (bandeau avec
// « Arrêter », son court), si le réglage `timer` des alertes télé est actif. Une télé qui se rallume ou se reconnecte
// peu après (LATE_MS) le reçoit encore. Quand le minuteur est arrêté (tablette, téléphone, ou une télé), les télés
// qui l'affichent reçoivent `timer-clear` et retirent le bandeau. Rien n'attend la télé : sans compte rendu, tant pis.
import { randomUUID } from 'node:crypto';
import type { ScreenEventBody } from '../../shared/screen.ts';
import type { Timer } from '../../shared/types.ts';
import type { ScreenAlertStore } from '../sources/screen-alerts.ts';
import type { TimerStore } from '../sources/timers.ts';
import type { Clock } from '../sources/types.ts';
import type { ScreenHub } from './screens.ts';

/** Au-delà, un minuteur terminé n'est plus envoyé à une télé qui arrive (il sonne toujours sur la tablette). */
export const LATE_MS = 5 * 60_000;
/** Attente du compte rendu de la télé (sans suite : l'événement est seulement oublié). */
export const TIMER_REPORT_MS = 10_000;
export const TIMER_CHECK_MS = 1_000;

/** « 5 min », « 1 h », « 1 h 30 » (comme la tablette, web/src/lib/timers.ts). */
function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** Textes du bandeau : le nom du minuteur, et « C'est l'heure ! (10 min) » comme sur la tablette. */
export function timerAlertText(timer: Pick<Timer, 'label' | 'durationSeconds'>): { title: string; subtitle: string } {
  return {
    title: timer.label || 'Minuteur',
    subtitle: `C’est l’heure !${timer.durationSeconds >= 60 ? ` (${duration(timer.durationSeconds)})` : ''}`,
  };
}

export function createTimerAlerts({
  timers,
  screens,
  hub,
  alerts,
  clock,
  logger = console,
}: {
  timers: TimerStore;
  /** Identifiants des télés appairées. */
  screens: { list(): Promise<{ id: string }[]> };
  hub: ScreenHub;
  alerts: ScreenAlertStore;
  clock: Clock;
  logger?: Pick<Console, 'error'>;
}) {
  /** Minuteurs envoyés à chaque télé, et pas encore retirés. */
  const sent = new Map<string, Set<string>>();
  let busy = false;

  const send = (screenId: string, event: ScreenEventBody) => {
    hub.send(screenId, event, TIMER_REPORT_MS).catch(() => {
      // Télé partie entre-temps : rien à faire, la tablette sonne quand même.
    });
  };

  /** Un tour de guet ; renvoyé pour les tests. */
  async function check() {
    if (busy) return;
    busy = true;
    try {
      const now = clock().getTime();
      const ringing = timers.list().filter((t) => new Date(t.endsAt).getTime() <= now);
      const ringingIds = new Set(ringing.map((t) => t.id));
      const known = new Set((await screens.list()).map((s) => s.id));
      const enabled = (await alerts.get()).timer;
      for (const id of sent.keys()) if (!known.has(id)) sent.delete(id);
      for (const id of known) {
        const shown = sent.get(id) ?? new Set<string>();
        sent.set(id, shown);
        const online = hub.online(id);
        // Arrêtés ailleurs : le bandeau s'en va.
        for (const timerId of shown) {
          if (ringingIds.has(timerId)) continue;
          shown.delete(timerId);
          if (online) send(id, { kind: 'timer-clear', id: randomUUID(), timerId });
        }
        if (!online || !enabled) continue;
        for (const timer of ringing) {
          if (shown.has(timer.id) || now - new Date(timer.endsAt).getTime() > LATE_MS) continue;
          shown.add(timer.id);
          send(id, { kind: 'timer', id: randomUUID(), timerId: timer.id, ...timerAlertText(timer) });
        }
      }
    } catch (err) {
      logger.error('Alerte des minuteurs sur les télés :', err);
    } finally {
      busy = false;
    }
  }

  return {
    check,
    /** Guette chaque seconde jusqu'à la fin du processus. */
    start() {
      setInterval(() => void check(), TIMER_CHECK_MS).unref();
    },
  };
}
