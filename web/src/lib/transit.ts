// Bus et tram Irigo : regroupement des passages et état du trajet du matin (logique pure, testée).
import type { Commute, Departure } from '../../../shared/types.ts';
import { formatTime } from './format.ts';

/** Minutes entières avant `at` (0 : maintenant ou passé). */
export const minutesUntil = (at: string, now: Date) => Math.max(0, Math.floor((Date.parse(at) - now.getTime()) / 60_000));

/** « 4 min », « à l'arrêt » ; au-delà d'une heure, l'heure (« 8 h 05 » → formatTime). */
export function departureText(d: Departure, now: Date): string {
  const minutes = minutesUntil(d.at, now);
  if (minutes === 0) return 'à l’arrêt';
  if (minutes >= 60) return formatTime(new Date(d.at));
  return `${minutes} min`;
}

export type DepartureRow = { line: string; destination: string; next: Departure[] };

/** Passages par ligne et destination (dans l'ordre du premier passage), `perRow` au plus chacun ; supprimés exclus. */
export function departureRows(departures: Departure[], now: Date, perRow = 2): DepartureRow[] {
  const rows = new Map<string, DepartureRow>();
  for (const d of departures) {
    if (d.cancelled || Date.parse(d.at) < now.getTime() - 30_000) continue;
    const key = `${d.line}→${d.destination}`;
    const row = rows.get(key) ?? { line: d.line, destination: d.destination, next: [] };
    if (row.next.length < perRow) row.next.push(d);
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** Tram (lettre) ou bus (numéro) : pour la couleur de la pastille de ligne. */
export const isTram = (line: string) => /^[A-Z]$/u.test(line);

const vehicle = (line: string) => (isTram(line) ? `le tram ${line}` : `le bus ${line}`);
/** Écart toléré entre l'horaire théorique et celui du temps réel pour reconnaître la même course. */
const SAME_TRIP_MS = 90_000;

export type CommuteState = {
  tone: 'go' | 'hurry' | 'late' | 'none';
  /** Minutes avant de partir de la maison (« Pars dans 2 min »). */
  leaveIn: number | null;
  title: string;
  detail: string;
};

/**
 * Où en est le trajet : prochain passage qu'on peut encore attraper en partant maintenant (marche comprise).
 * « Pars dans N min » (vert), « Pars maintenant » (orange, une minute ou moins), « Trop tard » si le seul passage
 * connu est déjà manqué ; sans passage : rien d'annoncé (la nuit, ou une ligne qui ne passe plus).
 */
export function commuteState(commute: Commute, now: Date): CommuteState {
  const where = `${commute.stop}${commute.label ? ` → ${commute.label}` : ''} · ${commute.walkMinutes} min à pied`;
  if (commute.plan) return plannedState(commute, commute.plan, now, where);
  const live = commute.departures.filter((d) => !d.cancelled);
  const leaveOf = (d: Departure) => (Date.parse(d.at) - now.getTime()) / 60_000 - commute.walkMinutes;
  const [next, after] = live.filter((d) => leaveOf(d) >= 0);
  if (!next) {
    const missed = live.at(-1);
    return missed
      ? { tone: 'late', leaveIn: null, title: `Trop tard pour ${vehicle(commute.line)} de ${formatTime(new Date(missed.at))}`, detail: where }
      : { tone: 'none', leaveIn: null, title: `Pas de ${isTram(commute.line) ? 'tram' : 'bus'} ${commute.line} annoncé`, detail: where };
  }
  const leaveIn = Math.floor(leaveOf(next));
  const at = formatTime(new Date(next.at));
  const detail = `${where}${after ? ` · suivant à ${formatTime(new Date(after.at))}` : ''}`;
  if (leaveIn <= 1) return { tone: 'hurry', leaveIn, title: `Pars maintenant pour ${vehicle(commute.line)} de ${at}`, detail };
  return { tone: 'go', leaveIn, title: `Pars dans ${leaveIn} min pour ${vehicle(commute.line)} de ${at}`, detail };
}

/**
 * Trajet calé sur l'emploi du temps : la course retenue (dernière qui fait arriver à temps), reconnue parmi les
 * passages annoncés par son horaire théorique. Pas encore annoncée (plus d'une heure avant) : son horaire prévu.
 * Supprimée : le prochain passage qu'on peut attraper, en le disant. Manquée : « Trop tard », et le suivant.
 */
function plannedState(commute: Commute, plan: NonNullable<Commute['plan']>, now: Date, where: string): CommuteState {
  const departs = Date.parse(plan.departs);
  const scheduled = formatTime(new Date(departs));
  const planned = commute.departures.find((d) => Math.abs(Date.parse(d.aimed ?? d.at) - departs) <= SAME_TRIP_MS);
  const course = `1er cours à ${formatTime(new Date(plan.firstCourse))}${plan.firstCancelled ? ' (un cours plus tôt est annulé)' : ''}`;
  if (planned?.cancelled) {
    const fallback = commuteState({ ...commute, plan: undefined, departures: commute.departures.filter((d) => d !== planned) }, now);
    return { ...fallback, detail: `${vehicle(commute.line).replace(/^l/u, "L")} de ${scheduled} est supprimé · ${fallback.detail}` };
  }
  const at = planned ? Date.parse(planned.at) : departs;
  const leaveMinutes = (at - now.getTime()) / 60_000 - commute.walkMinutes;
  const announced = !planned ? ' · horaire prévu' : planned.realtime && Math.abs(at - departs) >= 60_000 ? ` · annoncé à ${formatTime(new Date(at))}` : '';
  const detail = `${where} · ${course}${announced}`;
  if (leaveMinutes < 0) {
    const next = commute.departures.find((d) => !d.cancelled && Date.parse(d.at) > at && (Date.parse(d.at) - now.getTime()) / 60_000 >= commute.walkMinutes);
    return {
      tone: 'late',
      leaveIn: null,
      title: `Trop tard pour ${vehicle(commute.line)} de ${scheduled}`,
      detail: next ? `${where} · suivant à ${formatTime(new Date(next.at))}, après l’heure prévue` : detail,
    };
  }
  const leaveIn = Math.floor(leaveMinutes);
  if (leaveIn <= 1) return { tone: 'hurry', leaveIn, title: `Pars maintenant pour ${vehicle(commute.line)} de ${scheduled}`, detail };
  return { tone: 'go', leaveIn, title: `Pars dans ${leaveIn} min pour ${vehicle(commute.line)} de ${scheduled}`, detail };
}
