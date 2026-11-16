// Textes de la carte « Prochain trajet » : heure de partir en gros (« Pars dans 6 min », « Pars demain à 8 h 12 »),
// heures de départ et d'arrivée, rendez-vous visé, étapes en pastilles (à pied, bus, tram, retard), autre choix, ligne
// voiture, point de départ du calcul (position ou maison, et pourquoi), raison d'un trajet absent, et le diagnostic de
// la notification (réglages du téléphone). Logique pure, testée à part (next-trip.test.ts) ; les composants affichent.
import { type CarTrip, type LatLon, type NextTrip, type PlaceMiss, startOfKey, type TripDestination, type TripLeg, type TripMissing, type TripOption, type TripWatch } from '../../../shared/trip.ts';
import { dayDiff, formatDay } from './format.ts';

/** « 7 h 05 ». */
export const hourText = (date: Date) => `${date.getHours()} h ${String(date.getMinutes()).padStart(2, '0')}`;
const hour = (iso: string) => hourText(new Date(iso));

/** Durée lisible : « 6 min », « 1 h 05 ». */
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Heure de partir déjà passée de plus que ça : « Trop tard pour celui-ci ». */
const MISSED_MS = 60_000;
/** Au-delà de 3 h, l'heure de partir se dit avec le jour (« Pars demain à 8 h 12 ») plutôt qu'en durée. */
const COUNTDOWN_MS = 3 * 3_600_000;

/** « aujourd’hui », « demain », « lundi », « 12 nov. ». */
const dayWord = (date: Date, now: Date) => formatDay(date, now).toLowerCase();

/** Le gros titre : « Pars dans 6 min », « Pars maintenant », « Pars demain à 8 h 12 », ou trop tard. */
export function leaveTitle(leaveAt: string, now: Date): string {
  const ms = Date.parse(leaveAt) - now.getTime();
  if (ms < -MISSED_MS) return 'Trop tard pour celui-ci';
  if (ms > COUNTDOWN_MS) {
    const date = new Date(leaveAt);
    return dayDiff(now, date) === 0 ? `Pars à ${hourText(date)}` : `Pars ${dayWord(date, now)} à ${hourText(date)}`;
  }
  const minutes = Math.round(ms / 60_000);
  return minutes <= 0 ? 'Pars maintenant' : `Pars dans ${durationText(minutes)}`;
}

/** « à 7 h 22, pour y être à 7 h 46 » ; départ à plus de 3 h de `now` (déjà dit en gros) : « pour y être à 8 h 23 ». */
export function leaveLine(option: TripOption, now?: Date): string {
  const far = now !== undefined && Date.parse(option.leaveAt) - now.getTime() > COUNTDOWN_MS;
  return far ? `pour y être à ${hour(option.arrives)}` : `à ${hour(option.leaveAt)}, pour y être à ${hour(option.arrives)}`;
}

/** « Maths · 8 h 00 · Collège » ; un autre jour que `now` : « Dentiste · demain 9 h 30 · … ». */
export function destinationLine(d: TripDestination, now?: Date): string {
  const start = new Date(d.start);
  const when = now && dayDiff(now, start) !== 0 ? `${dayWord(start, now)} ${hour(d.start)}` : hour(d.start);
  return `${d.title} · ${when} · ${d.place}`;
}

const VEHICLE: Record<Exclude<TripLeg['mode'], 'walk'>, string> = { bus: 'bus', tram: 'tram', rail: 'train' };

export type LegChip = { mode: TripLeg['mode']; text: string; delay?: string; cancelled?: boolean };

/** Étapes en pastilles : « à pied 6 min », « tram A 7 h 29 » (+ « +3 min » si en retard). */
export function legChips(option: TripOption): LegChip[] {
  return option.legs.map((leg) => {
    if (leg.mode === 'walk') return { mode: 'walk', text: `à pied ${durationText(leg.minutes)}` };
    const delay = leg.delayMinutes ? (leg.delayMinutes > 0 ? `+${leg.delayMinutes} min` : `${leg.delayMinutes} min`) : undefined;
    return { mode: leg.mode, text: `${VEHICLE[leg.mode]} ${leg.line ?? ''} ${hour(leg.departs)}`.replace(/\s+/gu, ' '), ...(delay && { delay }), ...(leg.cancelled && { cancelled: true }) };
  });
}

/** Retard annoncé sur la première course, en clair (« Bus 3 : 3 min de retard ») ; null sans retard connu. */
export function delayLine(option: TripOption): string | null {
  const ride = option.legs.find((l) => l.mode !== 'walk' && l.delayMinutes);
  if (!ride?.delayMinutes) return null;
  const what = `${VEHICLE[ride.mode as Exclude<TripLeg['mode'], 'walk'>]} ${ride.line ?? ''}`.trim();
  const label = what.charAt(0).toUpperCase() + what.slice(1);
  return ride.delayMinutes > 0 ? `${label} : ${ride.delayMinutes} min de retard` : `${label} : ${-ride.delayMinutes} min d’avance`;
}

/** Ligne « autre choix » (plus tôt) ou « course suivante » (plus tard, arrivée après l'heure visée s'il le faut). */
export function otherLine(trip: NextTrip): string | null {
  if (!trip.other) return null;
  const ride = trip.other.legs.find((l) => l.mode !== 'walk');
  const how = ride ? ` · ${VEHICLE[ride.mode as Exclude<TripLeg['mode'], 'walk'>]} ${ride.line ?? ''}`.trimEnd() : ' · à pied';
  const later = trip.transit !== null && Date.parse(trip.other.leaveAt) > Date.parse(trip.transit.leaveAt);
  const tooLate = Date.parse(trip.other.arrives) > Date.parse(trip.arriveBy) ? ' (en retard)' : '';
  return `${later ? 'Course suivante' : 'Autre choix'} : pars à ${hour(trip.other.leaveAt)}, arrivée ${hour(trip.other.arrives)}${tooLate}${how}`;
}

/** « 4,8 km », « 800 m ». */
export function distanceText(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 100) * 100} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

export type CarLine = { minutes: string; leave: string; detail: string; url: string };

/** Ligne voiture : « 14 min », « pars à 8 h 36 », « trafic actuel compris · 4,8 km » (ou habituel, ou « sans trafic »). */
export function carLine(car: CarTrip): CarLine {
  const traffic = car.typical ? 'trafic habituel à cette heure' : 'trafic actuel compris';
  const detail = [car.traffic ? traffic : 'sans trafic', car.meters !== undefined ? distanceText(car.meters) : null].filter(Boolean).join(' · ');
  return { minutes: durationText(car.minutes), leave: `pars à ${hour(car.leaveAt)}`, detail, url: car.mapsUrl };
}

/** Position du téléphone (une minute de cache au plus) ; null si refusée, indisponible ou trop lente. */
export function currentPosition(geolocation: Geolocation | undefined = globalThis.navigator?.geolocation, timeoutMs = 10_000): Promise<LatLon | null> {
  if (!geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: timeoutMs },
    );
  });
}

/** Point de départ du calcul, dit clairement sous le trajet. */
export function originLine(trip: NextTrip): string {
  if (trip.from === 'position') return 'Calculé depuis ta position actuelle.';
  if (trip.homeBecause === 'far') return 'Calculé depuis la maison : le rendez-vous est dans plus de 3 h.';
  if (trip.homeBecause === 'tablet') return 'Calculé depuis la maison.';
  return 'Calculé depuis la maison : position du téléphone indisponible.';
}

/** Rendez-vous touché qui commence dans les 3 h : seul cas où le téléphone demande sa position. */
export function needsPosition(key: string, now: Date): boolean {
  const start = startOfKey(key);
  if (!start) return false;
  const ms = start.getTime() - now.getTime();
  return ms > 0 && ms <= COUNTDOWN_MS;
}

const MISSING: Record<TripMissing, string> = {
  event: 'Ce rendez-vous n’est plus dans l’agenda.',
  place: 'Le lieu de ce rendez-vous n’est pas reconnu.',
  past: 'Ce rendez-vous a déjà commencé.',
  origin: 'Pas de point de départ : aucun lieu « maison » sur la page Transports.',
  here: 'Tu es déjà sur place.',
};

/** Pourquoi le rendez-vous touché n'a pas de trajet ; `enabled` faux : MOTIS absent. */
export function missingText(missing: TripMissing | undefined, enabled: boolean): string {
  if (!enabled) return 'Les itinéraires ne sont pas configurés (MOTIS).';
  return missing ? MISSING[missing] : 'Pas de trajet pour ce rendez-vous.';
}

const MISS: Record<PlaceMiss, string> = {
  'no-search': 'ce n’est pas un lieu de la page Transports, et la recherche d’adresse n’est pas possible (centre météo non réglé)',
  'not-found': 'adresse introuvable ou incertaine',
  'too-far': 'adresse trouvée à plus de 30 km de la maison',
};

/** Avance de la notification sur l'heure de partir (comme le serveur). */
const NOTIFY_BEFORE_MS = 5 * 60_000;

/**
 * Diagnostic de la notification, en clair : le rendez-vous suivi (et l'heure de la notification), ou pourquoi aucun ;
 * les rendez-vous des 3 h dont le lieu n'est pas reconnu, et pourquoi.
 */
export function watchLines(watch: TripWatch): string[] {
  if (!watch.enabled) return ['Itinéraires non configurés (MOTIS) : pas de notification pour les rendez-vous.'];
  const lines: string[] = [];
  const { next } = watch;
  if (!next) lines.push('Aucun rendez-vous situé dans les 3 h.');
  else {
    const what = `Prochain rendez-vous suivi : ${next.title} à ${hour(next.start)}, ${next.place}.`;
    if (next.byCommute) lines.push(`${what} Notification du trajet du matin.`);
    else if (next.leaveAt) {
      const notify = new Date(Date.parse(next.leaveAt) - NOTIFY_BEFORE_MS);
      lines.push(`${what} Départ de la maison à ${hour(next.leaveAt)}, notification vers ${hourText(notify)}.`);
    } else lines.push(`${what} Aucun bus ni tram n’y arrive à temps depuis la maison : pas de notification.`);
  }
  for (const u of watch.unplaced) lines.push(`${u.title} à ${hour(u.start)} : lieu « ${u.location} » non reconnu (${MISS[u.reason]}).`);
  if (watch.unplaced.length > 0) lines.push('Écris l’adresse complète (numéro, rue, ville) ou le nom exact d’un lieu de la page Transports.');
  return lines;
}
