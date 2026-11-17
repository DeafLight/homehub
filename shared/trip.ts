// « Prochain trajet » (chantier « Prochain trajet », versions 2 et 2.1) : types échangés entre le serveur et le front,
// et petites règles communes (distance à vol d'oiseau, arrondi de l'origine envoyée à TomTom, lien Google Maps, clé
// d'un rendez-vous d'agenda et adresse de son trajet). Le téléphone ne voit que ses trajets (et ceux des rendez-vous
// de la famille) ; la tablette, ceux des rendez-vous qu'elle affiche déjà, calculés depuis la maison.

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
  /** Rendez-vous d'agenda : sa clé (`eventKey`), pour ouvrir son trajet depuis la notification. */
  key?: string;
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
  /** Vrai : trafic compris (TomTom) ; faux : durée sans trafic (MOTIS). */
  traffic: boolean;
  /** Rendez-vous lointain : trafic habituel à l'heure d'arrivée (TomTom), pas le trafic actuel. */
  typical?: boolean;
  /** Itinéraire dans Google Maps. */
  mapsUrl: string;
};

export type NextTrip = {
  destination: TripDestination;
  /** Heure d'arrivée visée : début du rendez-vous moins la marge. */
  arriveBy: string;
  /** Départ calculé depuis la position du téléphone, ou depuis la maison. */
  from: 'position' | 'home';
  /**
   * Pourquoi depuis la maison : rendez-vous dans plus de 3 h (`far` : on partira sans doute de la maison, la position
   * n'est pas demandée), tablette (`tablet`) ; absent : position du téléphone indisponible.
   */
  homeBecause?: 'far' | 'tablet';
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

/**
 * Pourquoi un rendez-vous d'agenda n'a pas de trajet : introuvable (ou d'un autre membre, pour un téléphone), lieu non
 * reconnu, déjà commencé, aucun point de départ (pas de lieu « maison »), ou déjà sur place.
 */
export type TripMissing = 'event' | 'place' | 'past' | 'origin' | 'here';

/** Réponse de POST /api/trip et /api/trip/event : le trajet, ou null (avec la raison pour un rendez-vous choisi). */
export type TripResponse = { enabled: boolean; trip: NextTrip | null; missing?: TripMissing };

/** Réponse de GET /api/trip/events : clés des rendez-vous de la semaine dont le lieu est reconnu (touchables). */
export type RoutableEvents = { keys: string[] };

/**
 * Pourquoi le lieu d'un rendez-vous n'est pas reconnu : ni un lieu de la famille, ni de recherche d'adresse possible
 * (centre ou Géoplateforme absents) ; adresse introuvable ou incertaine ; ou trouvée à plus de 30 km du centre.
 */
export type PlaceMiss = 'no-search' | 'not-found' | 'too-far';

/** Rendez-vous que la notification « Pars dans 5 min » surveille (diagnostic des réglages du téléphone). */
export type TripWatch = {
  /** MOTIS configuré ; sinon pas de notification de rendez-vous. */
  enabled: boolean;
  /** Prochain rendez-vous situé dans les 3 h, ou null. */
  next: {
    kind: 'course' | 'event';
    title: string;
    start: string;
    place: string;
    /** Heure de partir depuis la maison ; null si aucun itinéraire n'arrive à temps (pas de notification). */
    leaveAt: string | null;
    /** Cours d'un membre qui a un trajet réglé : la notification du trajet du matin s'en charge. */
    byCommute?: boolean;
  } | null;
  /** Rendez-vous des 3 h dont l'adresse n'est pas reconnue (avant celui suivi, ou tous), et pourquoi. */
  unplaced: { title: string; start: string; location: string; reason: PlaceMiss }[];
};

/** Clé d'un rendez-vous d'agenda (chaque occurrence d'un rendez-vous répété a la sienne) : identifiant et début. */
export const eventKey = (event: { id: string; start: string }) => `${event.id}@${event.start}`;

/** Début d'un rendez-vous d'après sa clé (après le dernier « @ ») ; null si la clé est illisible. */
export function startOfKey(key: string): Date | null {
  const at = key.lastIndexOf('@');
  const start = at > 0 ? Date.parse(key.slice(at + 1)) : Number.NaN;
  return Number.isNaN(start) ? null : new Date(start);
}

/** Paramètre et adresse du trajet d'un rendez-vous sur le téléphone (notification) : l'agenda, rendez-vous ouvert. */
export const TRIP_PARAM = 'trajet';
export const eventTripPath = (key: string) => `/m/agenda?${TRIP_PARAM}=${encodeURIComponent(key)}`;

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

// Carte en route (chantier « Prochain trajet », version 3) : l'itinéraire retenu avec ses tracés, et pour chaque bus ou
// tram la course entière (arrêts horodatés et tracé), d'où le téléphone estime la position du véhicule à prendre.

/** Point d'une étape : arrêt (avec son identifiant MOTIS) ou point de départ et d'arrivée. */
export type RoutePlace = { name: string; lat: number; lon: number; stopId?: string };

/** Arrêt d'une course, avec ses heures prévues (temps réel compris) et théoriques (ISO 8601). */
export type RouteStop = RoutePlace & { arrives?: string; departs?: string; scheduledArrives?: string; scheduledDeparts?: string };

/** Course entière d'un bus ou d'un tram : tracé [lon, lat], arrêts, et ceux de montée et de descente (indices). */
export type RouteCourse = { path: [number, number][]; stops: RouteStop[]; board: number; alight: number };

export type RouteLeg = {
  mode: TripLegMode;
  line?: string;
  headsign?: string;
  /** Course MOTIS (bus et tram) : pour rafraîchir ses heures en route. */
  tripId?: string;
  from: RoutePlace;
  to: RoutePlace;
  departs: string;
  arrives: string;
  scheduledDeparts: string;
  scheduledArrives: string;
  delayMinutes?: number;
  cancelled?: boolean;
  /** Tracé de l'étape, [lon, lat] (vide si MOTIS n'en donne pas). */
  path: [number, number][];
  /** Course entière (bus et tram), si MOTIS la donne. */
  course?: RouteCourse;
};

/** Itinéraire suivi sur la carte en route. */
export type TripRoute = {
  destination: TripDestination;
  arriveBy: string;
  late: boolean;
  legs: RouteLeg[];
  /** Parents : l'itinéraire en voiture dans Google Maps. */
  mapsUrl?: string;
};

/** Réponse de POST /api/trip/route. */
export type RouteResponse = { enabled: boolean; route: TripRoute | null };

/** Course suivie en route, dont le téléphone demande les nouvelles heures : course MOTIS, arrêts de montée et de descente. */
export type RideRef = { tripId: string; from: RoutePlace; to: RoutePlace };

/** Nouvelles heures d'une course suivie (null : MOTIS ne la trouve plus). */
export type RideUpdate = {
  tripId: string;
  departs: string;
  arrives: string;
  scheduledDeparts: string;
  scheduledArrives: string;
  delayMinutes?: number;
  cancelled?: boolean;
  course: RouteCourse;
};

/** Réponse de POST /api/trip/rides, dans l'ordre des courses demandées. */
export type RidesResponse = { rides: (RideUpdate | null)[] };
