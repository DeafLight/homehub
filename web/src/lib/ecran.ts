// Écran de veille de la télé (page /ecran, ouverte par l'appli HomeHub TV) : jeton de la télé lu dans l'adresse
// (/ecran#token=…, jamais envoyé au serveur dans l'adresse, retiré aussitôt), lecture des données avec ce jeton, et
// mise en forme (rendez-vous par jour, heure, menu, vacances). Fonctions pures, sauf la lecture réseau.
import type { EcranData, EcranEvent } from '../../../shared/ecran.ts';
import type { Weather } from '../../../shared/types.ts';
import { dayDiff, formatTime } from './format.ts';
import { formatTemperature } from './weather.ts';

export const ECRAN_PATH = '/ecran';

export const isEcranPath = (pathname: string) => pathname.replace(/\/+$/u, '') === ECRAN_PATH;

/** Lit `#token=…` et le retire de l'adresse ; null sans jeton (page ouverte à la main). */
export function takeScreenToken(win: Pick<Window, 'location' | 'history'> = window): string | null {
  const token = new URLSearchParams(win.location.hash.slice(1)).get('token')?.trim();
  if (!token) return null;
  win.history.replaceState(null, '', win.location.pathname + win.location.search);
  return token;
}

/** Réponse en clair d'une lecture : les données, ou pourquoi elles manquent (télé retirée, serveur injoignable). */
export type EcranLoad = { data: EcranData } | { error: 'unknown' | 'unreachable' };

export const ECRAN_UNKNOWN = 'Télé non reconnue : à appairer de nouveau depuis la tablette';
export const ECRAN_NO_TOKEN = 'Page de l’écran de veille de la télé : à ouvrir par l’appli HomeHub TV';

export async function loadEcran(token: string, fetcher: typeof fetch = fetch): Promise<EcranLoad> {
  try {
    const res = await fetcher('/api/screen/ecran', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (res.status === 401 || res.status === 403) return { error: 'unknown' };
    if (!res.ok) return { error: 'unreachable' };
    return { data: (await res.json()) as EcranData };
  } catch {
    return { error: 'unreachable' };
  }
}

export type EcranDay = { label: string; events: EcranEvent[] };

/** Rendez-vous rangés en « Aujourd'hui » et « Demain » (un rendez-vous commencé avant aujourd'hui y compte). */
export function ecranDays(events: readonly EcranEvent[], now: Date): EcranDay[] {
  const days: EcranDay[] = [
    { label: 'Aujourd’hui', events: [] },
    { label: 'Demain', events: [] },
  ];
  for (const event of events) {
    const diff = dayDiff(now, new Date(event.start));
    days[diff >= 1 ? 1 : 0].events.push(event);
  }
  return days.filter((d) => d.events.length > 0);
}

/** Heure à côté d'un rendez-vous : « 20:30 », « Journée » ; déjà commencé : « Jusqu’à 18:30 ». */
export function ecranTime(event: EcranEvent, now: Date): string {
  if (event.allDay) return 'Journée';
  const start = new Date(event.start);
  if (start <= now && event.end) {
    const end = new Date(event.end);
    return dayDiff(now, end) === 0 ? `Jusqu’à ${formatTime(end)}` : 'En cours';
  }
  return formatTime(start);
}

/** Titre d'un rendez-vous, avec le prénom du membre : « Léa · Piscine ». */
export const ecranTitle = (event: EcranEvent) => (event.who ? `${event.who} · ${event.title}` : event.title);

/** Titre du menu : « Ce soir » jusqu'à 21 h, puis plus rien (le repas est passé). */
export const showDinner = (dinner: readonly string[], now: Date) => dinner.length > 0 && now.getHours() < 21;

const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

/** Jour d'une prévision : « Demain », puis « mer. », « jeu. ». */
export function forecastDay(date: Date, now: Date): string {
  if (dayDiff(now, date) === 1) return 'Demain';
  const text = weekday.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Petit déplacement de tout l'écran (en % de la largeur et de la hauteur), changé régulièrement : sur une télé allumée
 * longtemps, rien ne reste au même endroit (marquage des écrans OLED).
 */
export function drift(random: () => number = Math.random): { x: number; y: number } {
  return { x: Math.round((random() * 4 - 2) * 10) / 10, y: Math.round((random() * 4 - 2) * 10) / 10 };
}

/** Ligne sous la météo du moment : « Min 4° · Max 12° · pluie vers 21:00 » (les jours suivants sont à côté). */
export function todayLine(weather: Weather, now: Date): string {
  const parts = [`Min ${formatTemperature(weather.today.minC)}`, `Max ${formatTemperature(weather.today.maxC)}`];
  if (weather.rainStartsAt) {
    const start = new Date(weather.rainStartsAt);
    parts.push(start <= now ? 'pluie en ce moment' : `pluie vers ${formatTime(start)}`);
  }
  return parts.join(' · ');
}
