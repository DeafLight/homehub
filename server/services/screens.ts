// Événements des télés appairées (appli HomeHub TV), en mémoire seulement. Chaque télé attend les siens par
// interrogation longue, comme la page tablette de la caméra en direct ; une télé qui ne demande plus rien depuis
// GONE_MS est absente (éteinte, appli fermée, réseau perdu). Un envoi attend le compte rendu de la télé (lecture
// commencée, ou échec et sa raison) pour répondre au téléphone ; sans nouvelles, il échoue au bout de `reportMs`.
// L'appli dit aussi où en est la télé (écran allumé, appli au premier plan, moyen d'action) : avec la présence, cela
// donne l'état montré par la télécommande (allumée, en veille, injoignable).
import type { RemotePower, ScreenEvent, ScreenEventBody, ScreenEvents, ScreenReport, ScreenStateReport } from '../../shared/screen.ts';
import { fail } from '../http.ts';
import type { Clock } from '../sources/types.ts';
import { GONE_MS, WAIT_MS } from './live-camera.ts';

/** Un événement reste lisible au plus ce temps : une télé qui se rallume ne rejoue pas un vieux message. */
export const EVENT_TTL_MS = 60_000;
/** Attente du compte rendu de la télé (téléchargement du message, début de la lecture). */
export const REPORT_MS = 20_000;

export const SCREEN_OFFLINE = 'Télé injoignable : éteinte, ou l’appli HomeHub TV n’est pas lancée';
export const SCREEN_SILENT = 'La télé n’a pas répondu';

type Box = {
  seq: number;
  items: (ScreenEvent & { at: number })[];
  waiters: Set<() => void>;
  seenAt: number;
  polling: number;
  /** Envois qui attendent le compte rendu de la télé, par identifiant d'événement. */
  reports: Map<string, (report: ScreenReport) => void>;
  /** Dernier état annoncé par l'appli. */
  state: ScreenStateReport | null;
};

export type ScreenHub = ReturnType<typeof createScreenHub>;

export function createScreenHub({
  clock,
  waitMs = WAIT_MS,
  goneMs = GONE_MS,
  reportMs = REPORT_MS,
}: {
  clock: Clock;
  waitMs?: number;
  goneMs?: number;
  reportMs?: number;
}) {
  const boxes = new Map<string, Box>();
  const now = () => clock().getTime();

  const boxOf = (id: string) => {
    let box = boxes.get(id);
    if (!box) {
      box = { seq: 0, items: [], waiters: new Set(), seenAt: Number.NEGATIVE_INFINITY, polling: 0, reports: new Map(), state: null };
      boxes.set(id, box);
    }
    return box;
  };

  const online = (id: string) => {
    const box = boxes.get(id);
    return box !== undefined && (box.polling > 0 || now() - box.seenAt < goneMs);
  };

  const sweep = (box: Box) => {
    const t = now();
    box.items = box.items.filter((e) => t - e.at < EVENT_TTL_MS);
  };

  return {
    online,

    /** État annoncé par l'appli de la télé `id` (null : rien reçu depuis le démarrage du serveur). */
    stateOf: (id: string): ScreenStateReport | null => boxes.get(id)?.state ?? null,

    setState(id: string, state: ScreenStateReport) {
      boxOf(id).state = state;
    },

    /** Allumée, en veille (écran éteint mais appli joignable), ou injoignable. Sans état annoncé : allumée. */
    power(id: string): RemotePower {
      if (!online(id)) return 'offline';
      return boxes.get(id)?.state?.screenOn === false ? 'standby' : 'on';
    },

    /** Événements de la télé `id` après `after` (null : télé qui démarre, tout ce qui est encore frais). */
    async events(id: string, after: number | null, abort?: AbortSignal): Promise<ScreenEvents> {
      const box = boxOf(id);
      sweep(box);
      box.seenAt = now();
      box.polling++;
      try {
        // L'attente se compte en temps réel (l'horloge injectée sert à la présence et à la fraîcheur).
        const deadline = performance.now() + waitMs;
        const from = after ?? 0;
        const found = () => box.items.filter((e) => e.seq > from).map(({ at: _at, ...event }) => event);
        let events = found();
        while (!events.length && !abort?.aborted && performance.now() < deadline) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              box.waiters.delete(done);
              abort?.removeEventListener('abort', done);
              resolve();
            };
            const timer = setTimeout(done, deadline - performance.now());
            box.waiters.add(done);
            abort?.addEventListener('abort', done, { once: true });
          });
          events = found();
        }
        return { events, last: box.seq };
      } finally {
        box.polling--;
        box.seenAt = now();
      }
    },

    /**
     * Envoie un événement à la télé et attend son compte rendu ; 503 si elle est absente. `waitMs` : attente du compte
     * rendu pour cet envoi (une touche n'attend pas autant qu'un message vocal à télécharger).
     */
    async send(id: string, event: ScreenEventBody, waitMs = reportMs): Promise<ScreenReport> {
      if (!online(id)) return fail(503, SCREEN_OFFLINE);
      const box = boxOf(id);
      sweep(box);
      const report = new Promise<ScreenReport>((resolve) => {
        const timer = setTimeout(() => {
          box.reports.delete(event.id);
          resolve({ ok: false, reason: SCREEN_SILENT });
        }, waitMs);
        box.reports.set(event.id, (r) => {
          clearTimeout(timer);
          box.reports.delete(event.id);
          resolve(r);
        });
      });
      box.items.push({ ...event, seq: ++box.seq, at: now() } as ScreenEvent & { at: number });
      for (const wake of box.waiters) wake();
      box.waiters.clear();
      return report;
    },

    /** Compte rendu de la télé pour l'événement `eventId` ; false si personne ne l'attend plus. */
    report(id: string, eventId: string, report: ScreenReport): boolean {
      const box = boxes.get(id);
      box?.items.splice(0, box.items.length, ...box.items.filter((e) => e.id !== eventId));
      const resolve = box?.reports.get(eventId);
      resolve?.(report);
      return resolve !== undefined;
    },

    /** Télé retirée : ses événements et sa présence sont oubliés, les envois en attente échouent. */
    forget(id: string) {
      const box = boxes.get(id);
      if (!box) return;
      for (const resolve of box.reports.values()) resolve({ ok: false, reason: 'Télé retirée' });
      for (const wake of box.waiters) wake();
      boxes.delete(id);
    },
  };
}
