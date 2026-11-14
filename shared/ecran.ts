// Écran de veille de la télé (appli HomeHub TV, fonction 8) : ce que GET /api/screen/ecran renvoie à la page /ecran.
// Seulement ce que la tablette montre déjà à tous (météo, agenda de la famille, menu du jour) : rien de personnel.
// Types et constantes uniquement, importés par le serveur et le front.
import type { HolidayStatus } from './school-holidays.ts';
import type { Weather, WeatherDay } from './types.ts';

/** Rendez-vous de l'agenda affiché : de la famille, ou d'un membre (prénom, comme sur l'accueil de la tablette). */
export type EcranEvent = {
  id: string;
  title: string;
  /** ISO 8601. */
  start: string;
  end?: string;
  allDay?: boolean;
  /** Prénom du membre ; null : la famille. */
  who: string | null;
};

export type EcranData = {
  /** null : météo non configurée ou indisponible. */
  weather: Weather | null;
  /** Les jours qui suivent (demain compris, 3 au plus) ; vide sans prévision. */
  days: WeatherDay[];
  /** Aujourd'hui et demain, triés (ECRAN_EVENTS_MAX au plus). */
  agenda: EcranEvent[];
  /** Recettes au menu aujourd'hui (le « menu du soir »), dans l'ordre du menu ; vide : rien de prévu. */
  dinner: string[];
  holiday: HolidayStatus | null;
};

/** Au plus autant de rendez-vous : lus de loin, sur une télé. */
export const ECRAN_EVENTS_MAX = 6;
/** Jours de prévision après aujourd'hui. */
export const ECRAN_DAYS = 3;
/** La page relit les données à ce rythme (le serveur garde météo et agenda en cache). */
export const ECRAN_REFRESH_MS = 5 * 60_000;
