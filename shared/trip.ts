// « Prochain trajet » du téléphone (chantier « Prochain trajet », version 2) : types échangés entre le serveur et le
// front, et petites règles communes (distance à vol d'oiseau, arrondi de l'origine envoyée à TomTom, lien Google Maps).
// Chacun ne voit que son trajet : la route ne connaît que le profil du téléphone qui demande.

export type LatLon = { lat: number; lon: number };

/** Rendez-vous visé : un cours (lieu « école » du membre) ou un rendez-vous d'agenda situé. */
export type TripDestination = {
  kind: 'course' | 'event';
  /** Matière ou titre du rendez-vous. */
  title: string;
  /** Début du rendez-vous (ISO 8601). */
  start: string;
  /** Nom du lieu (« Collège », ou l'adresse trouvée). */
  place: string;
  lat: number;
  lon: number;
};

/** Mode d'une étape : à pied, ou une course de bus, de tram ou de train. */
export type TripLegMode = 'walk' | 'bus' | 'tram' | 'rail';

export type TripLeg = {
  mode: TripLegMode;
  /** Ligne (« 3 », « A ») ; absente à pied. */
  line?: string;
  /** Direction de la course. */
  headsign?: string;
  /** Arrêt de montée et de descente (absents à pied). */
  from?: string;
  to?: string;
  /** Départ et arrivée prévus, temps réel compris (ISO 8601). */
  departs: string;
  arrives: string;
  minutes: number;
  /** Retard annoncé par le temps réel, en minutes (positif : en retard) ; absent sans temps réel. */
  delayMinutes?: number;
  cancelled?: boolean;
};

/** Un itinéraire en bus et tram : partir à `leaveAt`, arriver à `arrives`. */
export type TripOption = {
  leaveAt: string;
  arrives: string;
  legs: TripLeg[];
  /** Au moins une course est suivie en temps réel. */
  realtime: boolean;
};

/** Ligne voiture (parents) : durée avec le trafic (TomTom) ou sans (MOTIS, en secours). */
export type CarTrip = {
  minutes: number;
  leaveAt: string;
  /** Distance, en mètres, si connue. */
  meters?: number;
  /** Vrai : trafic actuel compris (TomTom) ; faux : durée sans trafic (MOTIS). */
  traffic: boolean;
  /** Itinéraire dans Google Maps. */
  mapsUrl: string;
};

export type NextTrip = {
  destination: TripDestination;
  /** Heure d'arrivée visée : début du rendez-vous moins la marge. */
  arriveBy: string;
  /** Départ calculé depuis la position du téléphone, ou depuis la maison faute de position. */
  from: 'position' | 'home';
  /** Itinéraire retenu ; null si MOTIS ne trouve rien ou ne répond pas. */
  transit: TripOption | null;
  /** Autre choix (plus tôt), ou la course suivante quand on est en retard. */
  other: TripOption | null;
  /** L'itinéraire retenu arrive après l'heure visée (trop tard pour le précédent). */
  late: boolean;
  /** Parents seulement ; absent pour un enfant. */
  car?: CarTrip | null;
};

/** Réponse de GET /api/trip : faut-il demander la position (un rendez-vous situé arrive bientôt) ? */
export type TripStatus = { enabled: boolean; upcoming: boolean };

/** Réponse de POST /api/trip : le trajet, ou null (rien de proche, déjà sur place, MOTIS absent). */
export type TripResponse = { enabled: boolean; trip: NextTrip | null };

const EARTH_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distance à vol d'oiseau, en mètres. */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/**
 * Origine arrondie à environ 100 m (trois décimales : 111 m en latitude, 75 m en longitude à Angers) : ce que TomTom
 * reçoit pour la ligne voiture d'un parent, jamais la position exacte du téléphone.
 */
export const roughly = (p: LatLon): LatLon => ({ lat: Math.round(p.lat * 1000) / 1000, lon: Math.round(p.lon * 1000) / 1000 });

/** Itinéraire en voiture vers `to` dans Google Maps (départ : la position que Google Maps trouvera lui-même). */
export const googleMapsUrl = (to: LatLon) =>
  `https://www.google.com/maps/dir/?api=1&destination=${to.lat.toFixed(6)},${to.lon.toFixed(6)}&travelmode=driving`;
