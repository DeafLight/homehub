// Notification « Pars dans 5 min » sur le téléphone (Web Push), vérifiée chaque minute pour chaque téléphone abonné :
// le trajet du matin (mêmes règles que la carte « Pars dans N min » et l'alerte de la télé : course de l'emploi du temps
// ou première qu'on peut encore attraper) et le prochain rendez-vous situé, calculé depuis la maison (le serveur n'a
// pas la position du téléphone). Une seule notification par trajet (gardée dans push.json). Le texte ne dit pas le
// prénom (le téléphone est à la personne) : ligne et heure.
import { localDay } from '../../shared/dates.ts';
import { eventTripPath, type NextTrip, type TripLeg } from '../../shared/trip.ts';
import type { Commute } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import type { PushRecord, PushStore } from '../sources/push.ts';
import type { Clock } from '../sources/types.ts';
import type { NextTripService } from './next-trip.ts';
import { targetOf } from './screen-bus.ts';
import type { PushMessage, PushResult } from './web-push.ts';

export const TRIP_PUSH_TICK_MS = 60_000;
/** Prévenir à 5 min de l'heure de partir (un peu plus tôt au besoin, la vérification passe chaque minute). */
export const PUSH_BEFORE_MS = 5 * 60_000;
/** Heure de partir déjà passée de moins que ça : encore annoncée (« Pars maintenant ») ; au-delà, trop tard. */
const LATE_MS = 60_000;

/** « 7 h 05 ». */
export const hourText = (date: Date) => `${date.getHours()} h ${String(date.getMinutes()).padStart(2, '0')}`;
const vehicle = (line: string, capital = true) => `${/^[A-Z]$/u.test(line) ? (capital ? 'Tram' : 'tram') : capital ? 'Bus' : 'bus'} ${line}`;
const leaveText = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  return minutes <= 0 ? 'Pars maintenant' : `Pars dans ${minutes} min`;
};

/** Notification du trajet du matin à envoyer maintenant, ou null (pas encore, ou trop tard). */
export function commuteMessage(commute: Commute, now: number): PushMessage | null {
  const bus = targetOf(commute, now);
  if (bus === null) return null;
  const leave = bus - commute.walkMinutes * 60_000 - now;
  if (leave > PUSH_BEFORE_MS || leave < -LATE_MS) return null;
  const then = (commute.plan?.legs ?? []).slice(1).map((l) => ` puis ${vehicle(l.line, false)}`).join('');
  return {
    title: leaveText(leave),
    body: `${vehicle(commute.line)} à ${hourText(new Date(bus))}${then} · ${commute.stop}${commute.label ? ` · vers ${commute.label}` : ''}`,
    tag: 'trajet',
    url: '/m',
  };
}

const rideText = (leg: TripLeg) => `${leg.mode === 'tram' ? 'Tram' : leg.mode === 'rail' ? 'Train' : 'Bus'} ${leg.line ?? ''}`.trim();

/** Notification du prochain rendez-vous à envoyer maintenant, ou null. */
export function tripMessage(trip: NextTrip, now: number): PushMessage | null {
  if (!trip.transit || trip.late) return null;
  const leave = Date.parse(trip.transit.leaveAt) - now;
  if (leave > PUSH_BEFORE_MS || leave < -LATE_MS) return null;
  const ride = trip.transit.legs.find((l) => l.mode !== 'walk');
  const how = ride ? `${rideText(ride)} à ${hourText(new Date(ride.departs))}` : 'À pied';
  const { destination: d } = trip;
  // Touchée, elle ouvre le trajet de ce rendez-vous (agenda) ; un cours, l'accueil (carte « Prochain trajet »).
  const url = d.kind === 'event' && d.key ? eventTripPath(d.key) : '/m';
  return { title: leaveText(leave), body: `${how} · ${d.title} à ${hourText(new Date(d.start))}`, tag: 'trajet', url };
}

export type TripPushDeps = {
  store: Pick<PushStore, 'all' | 'unsubscribe' | 'markSent'>;
  /** Téléphones encore appairés (un abonnement d'un téléphone retiré est oublié). */
  devices: () => Promise<{ id: string; ownerId: string }[]>;
  /** Trajet du matin du moment (null un jour sans école, hors des heures). */
  commuteOf: (ownerId: string) => Promise<Commute | null>;
  /** Le membre a un trajet réglé : ses cours passent par le trajet du matin, pas par le prochain rendez-vous. */
  hasCommute: (ownerId: string) => boolean;
  nextTrip: Pick<NextTripService, 'plan'>;
  send: (subscription: PushRecord, message: PushMessage) => Promise<PushResult>;
  clock: Clock;
  logger: Logger;
};

export function createTripPush({ store, devices, commuteOf, hasCommute, nextTrip, send, clock, logger }: TripPushDeps) {
  let running = false;

  /** Messages à envoyer maintenant à `ownerId`, avec la clé de leur trajet. */
  async function messagesFor(ownerId: string, now: Date): Promise<{ key: string; message: PushMessage }[]> {
    const out: { key: string; message: PushMessage }[] = [];
    const commute = await commuteOf(ownerId).catch(() => null);
    const fromCommute = commute && commuteMessage(commute, now.getTime());
    if (fromCommute) out.push({ key: `matin|${ownerId}|${localDay(now)}`, message: fromCommute });
    const trip = await nextTrip.plan(ownerId, null, { firstCourseOnly: true }).catch(() => null);
    if (trip && !(trip.destination.kind === 'course' && hasCommute(ownerId))) {
      const fromTrip = tripMessage(trip, now.getTime());
      if (fromTrip) out.push({ key: `rdv|${ownerId}|${trip.destination.start}|${trip.destination.title}`, message: fromTrip });
    }
    return out;
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const now = clock();
      const paired = new Map((await devices()).map((d) => [d.id, d.ownerId]));
      const subscriptions = await store.all();
      for (const sub of subscriptions) {
        if (paired.get(sub.deviceId) !== sub.ownerId) await store.unsubscribe(sub.deviceId);
      }
      // Téléphones encore appairés qui veulent « Pars dans 5 min » (réglage du téléphone).
      const wanted = subscriptions.filter((s) => paired.get(s.deviceId) === s.ownerId && s.prefs.trips);
      const owners = [...new Set(wanted.map((s) => s.ownerId))];
      for (const ownerId of owners) {
        for (const { key, message } of await messagesFor(ownerId, now)) {
          if (!(await store.markSent(key))) continue;
          for (const sub of wanted.filter((s) => s.ownerId === ownerId)) {
            const result = await send(sub, message);
            if (result === 'gone') await store.unsubscribe(sub.deviceId);
            else if (result === 'failed') logger.error('Notification « Pars dans 5 min » non remise au service de push');
          }
        }
      }
    } finally {
      running = false;
    }
  }

  return { tick, start: () => setInterval(() => void tick().catch((err: unknown) => logger.error(`Notifications de trajet : ${(err as Error).message}`)), TRIP_PUSH_TICK_MS).unref() };
}
