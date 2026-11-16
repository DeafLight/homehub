// Textes de la carte « Prochain trajet » du téléphone : heure de partir en gros (« Pars dans 6 min »), heures de départ
// et d'arrivée, rendez-vous visé, étapes en pastilles (à pied, bus, tram, retard), autre choix et ligne voiture des
// parents. Logique pure, testée à part (next-trip.test.ts) ; le composant ne fait qu'afficher.
import type { CarTrip, LatLon, NextTrip, TripDestination, TripLeg, TripOption } from '../../../shared/trip.ts';

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

/** Le gros titre : « Pars dans 6 min », « Pars maintenant », ou trop tard. */
export function leaveTitle(leaveAt: string, now: Date): string {
  const ms = Date.parse(leaveAt) - now.getTime();
  if (ms < -MISSED_MS) return 'Trop tard pour celui-ci';
  const minutes = Math.round(ms / 60_000);
  return minutes <= 0 ? 'Pars maintenant' : `Pars dans ${durationText(minutes)}`;
}

/** « à 7 h 22, pour y être à 7 h 46 ». */
export const leaveLine = (option: TripOption) => `à ${hour(option.leaveAt)}, pour y être à ${hour(option.arrives)}`;

/** « Maths · 8 h 00 · Collège ». */
export const destinationLine = (d: TripDestination) => `${d.title} · ${hour(d.start)} · ${d.place}`;

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

/** Ligne voiture : « 14 min », « pars à 8 h 36 », « trafic actuel compris · 4,8 km » (ou « sans trafic »). */
export function carLine(car: CarTrip): CarLine {
  const detail = [car.traffic ? 'trafic actuel compris' : 'sans trafic', car.meters !== undefined ? distanceText(car.meters) : null].filter(Boolean).join(' · ');
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
