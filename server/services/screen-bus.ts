// Alerte du bus du matin sur la télé (appli HomeHub TV, fonction 4) : « Bus dans 9 min », en bandeau par-dessus le
// programme. Mêmes règles que la carte « Pars dans N min » de la tablette (services/transit.ts, via le dashboard) :
// jours et heures du trajet, ou course calée sur l'emploi du temps ; rien un jour sans école (vacances, férié). Le
// réglage est par trajet (page Transports : « Alerte sur la télé », minutes avant l'heure de partir). Une alerte par
// membre et par jour, envoyée à toutes les télés joignables ; si aucune ne l'est, on réessaie tant qu'il est temps.
import { randomUUID } from 'node:crypto';
import { localDay } from '../../shared/dates.ts';
import type { ScreenBusEvent } from '../../shared/screen.ts';
import type { Commute, Departure } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import type { Clock } from '../sources/types.ts';
import type { ScreenHub } from './screens.ts';

/** Fréquence de la vérification. */
export const BUS_TICK_MS = 20_000;
/** Durée du bandeau sur la télé. */
export const BUS_BANNER_SECONDS = 45;
/** Attente du compte rendu de la télé (un bandeau s'affiche tout de suite). */
export const BUS_REPORT_MS = 5_000;
/** Heure de partir dépassée de moins que ça : « Pars maintenant » ; au-delà, trop tard, pas d'alerte. */
const LATE_MS = 60_000;
/** Écart toléré entre l'horaire prévu (emploi du temps) et celui du temps réel pour reconnaître la même course. */
const SAME_TRIP_MS = 90_000;

/** Ce que le dashboard donne pour un membre : son trajet du moment et l'avance voulue, ou null (pas d'alerte). */
export type BusAlertSource = (ownerId: string) => Promise<{ commute: Commute; minutes: number } | null>;

const departsAt = (d: Departure) => Date.parse(d.at);

/** Course visée : celle de l'emploi du temps s'il y en a une, sinon la première qu'on peut encore attraper. */
export function targetOf(commute: Commute, now: number): number | null {
  const walk = commute.walkMinutes * 60_000;
  if (commute.plan) {
    const planned = Date.parse(commute.plan.departs);
    const live = commute.departures.find((d) => Math.abs(Date.parse(d.aimed ?? d.at) - planned) <= SAME_TRIP_MS);
    return live ? departsAt(live) : planned;
  }
  const next = commute.departures.find((d) => departsAt(d) - walk >= now - LATE_MS);
  return next ? departsAt(next) : null;
}

const inMinutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));

/**
 * Bandeau à envoyer pour `name` maintenant, ou null : pas de course, ou heure de partir encore à plus de `minutes`
 * minutes, ou déjà passée.
 */
export function busAlertOf(commute: Commute, minutes: number, now: number, name: string): Omit<ScreenBusEvent, 'id'> | null {
  const bus = targetOf(commute, now);
  if (bus === null) return null;
  const leave = bus - commute.walkMinutes * 60_000 - now;
  if (leave > minutes * 60_000 || leave < -LATE_MS) return null;
  const busIn = inMinutes(bus - now);
  const leaveIn = inMinutes(leave);
  // Correspondances (itinéraire de MOTIS) : « ligne 3 puis tram A vers Collège ».
  const then = (commute.plan?.legs ?? []).slice(1).map((l) => ` puis ${/^[A-Z]$/u.test(l.line) ? 'tram' : 'bus'} ${l.line}`).join('');
  const where = `ligne ${commute.line}${then}${commute.label ? ` vers ${commute.label}` : ''}`;
  return {
    kind: 'bus',
    title: busIn === 0 ? 'Le bus arrive' : `Bus dans ${busIn} min`,
    subtitle: `${name} · ${where} · ${leaveIn === 0 ? 'pars maintenant' : `pars dans ${leaveIn} min`}`,
    seconds: BUS_BANNER_SECONDS,
  };
}

export type ScreenBusAlerts = ReturnType<typeof createScreenBusAlerts>;

export function createScreenBusAlerts({
  members,
  alertOf,
  screens,
  hub,
  clock,
  logger,
}: {
  /** Membres de la maison (identifiant et prénom). */
  members: () => { id: string; name: string }[];
  alertOf: BusAlertSource;
  /** Télés appairées. */
  screens: () => Promise<string[]>;
  hub: Pick<ScreenHub, 'online' | 'send'>;
  clock: Clock;
  logger: Logger;
}) {
  /** Alertes déjà envoyées : « membre|jour ». */
  const sent = new Set<string>();
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const now = clock();
      const today = localDay(now);
      for (const key of sent) if (!key.endsWith(`|${today}`)) sent.delete(key);
      for (const member of members()) {
        const key = `${member.id}|${today}`;
        if (sent.has(key)) continue;
        const wanted = await alertOf(member.id).catch(() => null);
        const body = wanted && busAlertOf(wanted.commute, wanted.minutes, now.getTime(), member.name);
        if (!body) continue;
        const online = (await screens()).filter((id) => hub.online(id));
        if (online.length === 0) continue;
        sent.add(key);
        await Promise.all(
          online.map(async (id) => {
            const report = await hub.send(id, { ...body, id: randomUUID() }, BUS_REPORT_MS).catch((err: unknown) => ({ ok: false as const, reason: String(err) }));
            if (!report.ok) logger.error(`Alerte du bus sur la télé ${id} : ${report.reason}`);
          }),
        );
      }
    } finally {
      running = false;
    }
  }

  return { tick };
}
