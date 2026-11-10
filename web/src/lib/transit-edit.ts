// Page « Transports » : modifier lieux, trajets et arrêts de l'accueil avant de tout enregistrer (logique pure, testée).
import type { AddressMatch, CommuteRoute, CommuteSettings, PlaceIcon, RouteOption, TransitPlace, TransitSettings } from '../../../shared/types.ts';

export const MAX_PLACES = 8;
export const MAX_HOME_STOPS = 4;
export const PLACE_ICONS: PlaceIcon[] = ['home', 'school', 'sport', 'place'];

/** Icône suivante, d'un toucher sur celle du lieu. */
export const nextIcon = (icon: PlaceIcon): PlaceIcon => PLACE_ICONS[(PLACE_ICONS.indexOf(icon) + 1) % PLACE_ICONS.length];

/** Identifiant libre (« p1 », « p2 »…), stable une fois enregistré : les trajets y renvoient. */
export function newPlaceId(places: Pick<TransitPlace, 'id'>[]): string {
  let n = places.length + 1;
  while (places.some((p) => p.id === `p${n}`)) n++;
  return `p${n}`;
}

/** Nom et icône proposés pour un nouveau lieu : la maison d'abord, puis l'école. */
export function suggestPlace(places: Pick<TransitPlace, 'icon'>[]): { label: string; icon: PlaceIcon } {
  if (!places.some((p) => p.icon === 'home')) return { label: 'Maison', icon: 'home' };
  if (!places.some((p) => p.icon === 'school')) return { label: 'École', icon: 'school' };
  return { label: '', icon: 'place' };
}

/** Trajet par défaut : de la maison vers l'école (si elles existent), en semaine, calé sur l'emploi du temps. */
export function newCommute(places: TransitPlace[]): CommuteSettings {
  const from = places.find((p) => p.icon === 'home') ?? places[0];
  const to = places.find((p) => p.icon === 'school' && p !== from) ?? places.find((p) => p !== from) ?? from;
  return {
    from: from?.id ?? '',
    to: to?.id ?? '',
    route: null,
    mode: 'school',
    days: [1, 2, 3, 4, 5],
    window: { from: '07:00', to: '08:30' },
    arriveBefore: 10,
    showBefore: 30,
    walkFrom: null,
    walkTo: null,
  };
}

export const routeKey = (r: Pick<CommuteRoute, 'line' | 'origin' | 'destination'>) => `${r.line}|${r.origin}|${r.destination}`;

export function toggleDay(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
}

/** Lieux utilisés par un trajet : on ne peut pas les supprimer. */
export const placeInUse = (settings: Pick<TransitSettings, 'commutes'>, placeId: string) =>
  Object.values(settings.commutes).some((c) => c.from === placeId || c.to === placeId);

/** Première chose qui empêche d'enregistrer, en clair ; null si tout va bien. */
export function settingsProblem(settings: Omit<TransitSettings, 'saved'>, nameOf: (id: string) => string): string | null {
  const labels = new Set<string>();
  for (const place of settings.places) {
    const label = place.label.trim().toLowerCase();
    if (!label) return 'Un lieu n’a pas de nom';
    if (labels.has(label)) return `Deux lieux s’appellent « ${place.label.trim()} »`;
    labels.add(label);
  }
  for (const [ownerId, c] of Object.entries(settings.commutes)) {
    const who = nameOf(ownerId);
    if (c.from === c.to) return `Trajet de ${who} : départ et arrivée identiques`;
    if (!c.route) return `Trajet de ${who} : choisis une ligne`;
    if (c.days.length === 0) return `Trajet de ${who} : choisis au moins un jour`;
    if (c.mode === 'window' && c.window.from >= c.window.to) return `Trajet de ${who} : l’heure de début doit précéder la fin`;
    if (c.showBefore < 5) return `Trajet de ${who} : carte affichée au moins 5 min avant`;
  }
  return null;
}

/** Ce qu'on envoie : sans le drapeau `saved`, noms nettoyés. */
export function toInput(settings: TransitSettings): Omit<TransitSettings, 'saved'> {
  return {
    places: settings.places.map((p) => ({ ...p, label: p.label.trim() })),
    commutes: settings.commutes,
    stops: settings.stops,
  };
}

/** Adresse choisie pour un lieu existant (les trajets qui en partent ou y mènent sont à revoir) ou pour un nouveau. */
export function placeAddress(settings: TransitSettings, target: string, match: AddressMatch): void {
  const place = settings.places.find((p) => p.id === target);
  if (place) {
    Object.assign(place, { address: match.label, lat: match.lat, lon: match.lon });
    for (const c of Object.values(settings.commutes)) if (c.from === place.id || c.to === place.id) c.route = null;
  } else {
    settings.places.push({ id: newPlaceId(settings.places), ...suggestPlace(settings.places), address: match.label, lat: match.lat, lon: match.lon });
  }
}

/** Clé des arrêts proches d'un lieu (ses coordonnées). */
export const nearKey = (place: Pick<TransitPlace, 'lat' | 'lon'>) => `${place.lat},${place.lon}`;

/** Clé de la recherche d'itinéraires entre deux lieux ; vide s'il en manque un. */
export const endsKey = (from: TransitPlace | undefined, to: TransitPlace | undefined) => (from && to ? `${nearKey(from)}>${nearKey(to)}` : '');

/** Itinéraires proposés, et celui déjà choisi s'il n'en fait plus partie (horaires changés), en tête. */
export function routeChoices(routes: RouteOption[] | null, chosen: CommuteRoute | null | undefined): RouteOption[] {
  const list = routes ?? [];
  if (!chosen || list.some((r) => routeKey(r) === routeKey(chosen))) return list;
  return [{ ...chosen, totalMinutes: chosen.walkFrom + chosen.rideMinutes + chosen.walkTo }, ...list];
}

/** Temps de marche saisi : vide (ou illisible) = revenir à l'estimation, sinon de 0 à 60 min. */
export function walkMinutes(value: string): number | null {
  const n = Number(value);
  return value === '' || !Number.isFinite(n) ? null : Math.max(0, Math.min(60, Math.round(n)));
}

/** Minutes saisies pour « arriver avant » (0 à 60) ou « carte affichée » (0 à 120) ; null si illisible. */
export function boundedMinutes(field: 'arriveBefore' | 'showBefore', value: string): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(field === 'showBefore' ? 120 : 60, n)) : null;
}
