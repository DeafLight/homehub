// Contrat de l'API, partagé entre le serveur et le front.
// Types et constantes uniquement, sans dépendance : il est importé des deux côtés.
import type { Unit } from './ingredients.ts';
import type { HolidayStatus, SchoolHoliday } from './school-holidays.ts';

/** Identifiant réservé au dashboard commun de la famille. */
export const FAMILY_ID = 'famille';

export type Member = {
  id: string;
  name: string;
  /** Couleur d'accent, au format #rrggbb. */
  color: string;
  /** Parent : écrit sur tous les profils ; sinon (enfant), seulement sur le sien. */
  parent: boolean;
  /** A un programme de renforcement (onglet Sport du téléphone). */
  fitness?: boolean;
};

/** Calcul des empreintes sur la tablette (`faces.backend` de homehub.yaml, voir server/config.ts). */
export const FACE_BACKENDS = ['webgl', 'webgl-safe', 'cpu'] as const;
export type FaceBackend = (typeof FACE_BACKENDS)[number];

/** Configuration visible par le front (aucun secret). */
export type PublicConfig = {
  members: Member[];
  family: { name: string };
  ui: { idleTimeoutSeconds: number; screensaverMinutes: number };
  /** Détection des visages sur la tablette (voir `faces` dans homehub.yaml). */
  faces: { minConfidence: number; minSize: number; backend: FaceBackend };
  /** Empreinte de la configuration : change à chaque modification du fichier. */
  revision: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  /** Début, ISO 8601 (minuit local pour un événement sur la journée). */
  start: string;
  /** Fin, ISO 8601, exclusive (minuit du lendemain du dernier jour pour un événement sur la journée). */
  end?: string;
  /** Événement sur la journée entière : pas d'heure à afficher. */
  allDay?: boolean;
  location?: string;
};

export type Task = {
  id: string;
  label: string;
  done: boolean;
};

/** Mot laissé à un membre, ou à toute la famille (`to` = FAMILY_ID). Il s'efface une fois vu, ou au bout de 7 jours. */
export type Note = {
  id: string;
  text: string;
  to: string;
  from: Author;
  at: string;
  seenAt?: string;
  seenBy?: Author;
};

export type Weather = {
  /** Nom du lieu, tel que configuré. */
  location: string;
  temperatureC: number;
  /** Code météo WMO (0 = ciel dégagé … 99 = orage avec grêle) ; le front en tire libellé et icône. */
  weatherCode: number;
  isDay: boolean;
  today: { minC: number; maxC: number };
  tomorrow: { minC: number; maxC: number; weatherCode: number } | null;
  /** Début du prochain créneau horaire pluvieux dans les 12 h (ISO 8601), ou null. Peut être déjà passé : il pleut. */
  rainStartsAt: string | null;
};

/** Une heure de prévision (le créneau commence à `time`). */
export type WeatherHour = {
  /** ISO 8601. */
  time: string;
  temperatureC: number;
  /** Cumul de pluie sur l'heure (mm). */
  precipitationMm: number;
  weatherCode: number;
  isDay: boolean;
};

export type WeatherDay = {
  /** Minuit local du jour, ISO 8601. */
  date: string;
  weatherCode: number;
  minC: number;
  maxC: number;
  /** null : donnée absente de la prévision. */
  precipitationMm: number | null;
  windMaxKmh: number | null;
  sunrise: string | null;
  sunset: string | null;
};

/** Prévision détaillée, pour la page météo. */
export type WeatherForecast = {
  location: string;
  /** Heure de l'observation « actuelle » du modèle (ISO 8601). */
  observedAt: string;
  current: {
    temperatureC: number;
    apparentC: number | null;
    weatherCode: number;
    isDay: boolean;
    humidityPct: number | null;
    windKmh: number | null;
    gustsKmh: number | null;
    /** Direction d'où vient le vent, en degrés (0 = nord). */
    windFromDeg: number | null;
  };
  /** Les 24 prochaines heures, à partir de l'heure en cours. */
  hours: WeatherHour[];
  /** Aujourd'hui puis les jours suivants couverts par le modèle (4 au plus). */
  days: WeatherDay[];
};

/** Cours de l'emploi du temps scolaire. */
export type SchoolCourse = {
  id: string;
  subject: string;
  /** ISO 8601. */
  start: string;
  end: string;
  room?: string;
  teacher?: string;
  cancelled: boolean;
};

/** Emploi du temps d'aujourd'hui et de demain (listes vides : pas de cours ce jour-là). */
export type SchoolDays = {
  today: SchoolCourse[];
  tomorrow: SchoolCourse[];
};

/** Devoir du cahier de texte (Pronote ou ÉcoleDirecte), en lecture seule : on le coche dans leur appli. */
export type Homework = {
  id: string;
  subject: string;
  /** Jour où il est à faire, AAAA-MM-JJ (heure locale). */
  due: string;
  /** Consigne, en texte simple (le HTML du service est retiré). */
  text: string;
  done: boolean;
  /** Contrôle ou interrogation prévu ce jour-là (ÉcoleDirecte). */
  test?: boolean;
  /** Couleur de la matière donnée par le service (Pronote). */
  color?: string;
  /** Nombre de pièces jointes, à ouvrir dans l'appli du service. */
  attachments?: number;
  /** Durée prévue par le professeur, en minutes (Pronote). */
  minutes?: number;
};

/** Note d'un devoir (Pronote ou ÉcoleDirecte), en lecture seule. */
export type SchoolGrade = {
  id: string;
  subject: string;
  /** Jour du devoir, AAAA-MM-JJ (heure locale). */
  date: string;
  /** Note telle que le service l'écrit : « 15,5 », ou « Abs », « Disp »… */
  value: string;
  /** Barème (20 le plus souvent) ; null s'il n'est pas donné. */
  outOf: number | null;
  /** Intitulé du devoir (« Contrôle fractions »), s'il y en a un. */
  title?: string;
  coefficient?: number;
  /** Moyenne de la classe à ce devoir, écrite comme la note. */
  classAverage?: string;
};

/** Absence ou retard relevé par la vie scolaire. */
export type SchoolAttendance = {
  id: string;
  kind: 'absence' | 'delay';
  /** Jour, AAAA-MM-JJ (heure locale). */
  date: string;
  /** Durée telle qu'on la dit : « 1 demi-journée », « 2 h », « 10 min ». */
  duration: string;
  justified: boolean;
  /** Motif donné par l'établissement. */
  reason?: string;
};

/** Message reçu sur la messagerie du service : l'objet seulement (le lire dans l'appli le marquerait lu). */
export type SchoolMessage = {
  id: string;
  subject: string;
  from: string;
  /** ISO 8601. */
  date: string;
  read: boolean;
};

export type SchoolService = 'ÉcoleDirecte' | 'Pronote';

/** Vie scolaire d'un enfant : null quand la rubrique est indisponible (fermée au compte, panne). */
export type SchoolLifeChild = {
  ownerId: string;
  /** Notes récentes, de la plus récente à la plus ancienne. */
  grades: SchoolGrade[] | null;
  /** Absences et retards de l'année (ou de la période), du plus récent au plus ancien. */
  attendance: SchoolAttendance[] | null;
};

/** Vie scolaire des enfants, réservée aux parents (GET /api/school/life). */
export type SchoolLife = {
  children: SchoolLifeChild[];
  /** Messagerie de chaque compte (un compte Famille par service), messages récents d'abord. */
  messages: { service: SchoolService; items: SchoolMessage[] }[];
};

/** Passage d'un bus ou d'un tram Irigo à un arrêt. */
export type Departure = {
  /** Ligne affichée : « 3 », « A ». */
  line: string;
  destination: string;
  /** Heure de départ, ISO 8601 : prévue en temps réel si `realtime`, sinon théorique. */
  at: string;
  realtime: boolean;
  /** Heure théorique (ISO 8601), quand le temps réel en annonce une autre : reconnaît la course prévue. */
  aimed?: string;
  cancelled?: boolean;
};

export type TransitStop = { id: string; label: string; departures: Departure[] };

/** Perturbation en cours sur une ou plusieurs lignes (flux d'alertes Irigo). */
export type TransitAlert = { id: string; lines: string[]; title: string; url?: string };

/** Prochains passages aux arrêts suivis (accueil, veille) ; `stops` vide si rien n'est configuré. */
export type TransitData = { stops: TransitStop[]; alerts: TransitAlert[] };

/** Course retenue d'après l'emploi du temps : arriver avant le premier cours, marge comprise. */
export type CommutePlan = {
  /** Départ prévu de l'arrêt (horaire théorique), arrivée prévue à l'arrêt d'arrivée, départ de la maison. */
  departs: string;
  arrives: string;
  leaveAt: string;
  /** Premier cours non annulé ; `firstCancelled` : un cours plus tôt est annulé. */
  firstCourse: string;
  firstCancelled: boolean;
};

/** Trajet du matin d'un membre, à ses heures : prochains passages de sa ligne à son arrêt. */
export type Commute = {
  line: string;
  stop: string;
  label?: string;
  walkMinutes: number;
  departures: Departure[];
  alerts: TransitAlert[];
  /** Absent : trajet sur une plage horaire fixe (pas d'emploi du temps). */
  plan?: CommutePlan;
};

// --- Page « Transports » ---

export type PlaceIcon = 'home' | 'school' | 'sport' | 'place';
/** Lieu de la famille (maison, école…), situé par son adresse. */
export type TransitPlace = { id: string; label: string; icon: PlaceIcon; address: string; lat: number; lon: number };
/** Résultat de la recherche d'adresse. */
export type AddressMatch = { label: string; lat: number; lon: number };
/** Arrêt Irigo : lignes qui y passent, destinations des courses (distinguent les deux quais). */
export type StopChoice = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lines: string[];
  towards: string[];
  /** Depuis le lieu demandé : distance à vol d'oiseau et marche estimée. */
  meters?: number;
  walkMinutes?: number;
};
/** Ligne directe entre deux lieux, d'après les horaires théoriques ; marches estimées. */
export type CommuteRoute = {
  line: string;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  /** Destination la plus fréquente des courses ; `headsigns` : toutes celles qui desservent l'arrivée. */
  towards: string;
  headsigns: string[];
  /** Vrai si toutes les courses de la ligne à l'arrêt de départ desservent l'arrivée (quai à sens unique). */
  oneWay: boolean;
  rideMinutes: number;
  walkFrom: number;
  walkTo: number;
};
export type RouteOption = CommuteRoute & { totalMinutes: number };
/** Trajet réglé d'un membre. `days` : 0 = dimanche. Marches null : estimation de l'itinéraire. */
export type CommuteSettings = {
  from: string;
  to: string;
  route: CommuteRoute | null;
  mode: 'school' | 'window';
  days: number[];
  window: TimeWindow;
  /** Minutes : arriver avant le premier cours ; carte affichée avant l'heure de départ de la maison. */
  arriveBefore: number;
  showBefore: number;
  walkFrom: number | null;
  walkTo: number | null;
};
export type HomeStop = { id: string; label?: string; lines?: string[] };
export type TransitSettings = {
  places: TransitPlace[];
  commutes: Record<string, CommuteSettings>;
  /** Arrêts de l'accueil. */
  stops: HomeStop[];
  /** Faux tant que la page n'a jamais été enregistrée (réglages du fichier YAML). */
  saved: boolean;
};

export type RoutinePeriod = 'morning' | 'evening';

/** Étape de routine réglée : `days` (0 : dimanche) null pour tous les jours ; `id` stable (clé des cases cochées). */
export type RoutineStepPlan = { id: string; label: string; days: number[] | null };
export type RoutinePlan = Record<RoutinePeriod, RoutineStepPlan[]>;
export type TimeWindow = { from: string; to: string };
export type RoutineWindows = Record<RoutinePeriod, TimeWindow> & { weekend?: Partial<Record<RoutinePeriod, TimeWindow>> };
/** Réglages des routines (page « Routines ») : heures, et étapes de chaque membre. */
export type RoutineSettings = { windows: RoutineWindows; members: Record<string, RoutinePlan> };

/** Routine du moment (matin ou soir) d'un membre : liste qui repart de zéro chaque jour. */
export type Routine = {
  period: RoutinePeriod;
  /** Une étape par élément ; `id` : `<période>-<rang>`. */
  items: Task[];
  /** Jours de suite où la routine de cette période a été faite en entier (aujourd'hui compris s'il l'est déjà). */
  streak: number;
};

/** Résumé d'un profil (un membre, ou la famille) pour l'écran d'accueil. */
export type ProfileSummary = {
  ownerId: string;
  nextEvent: CalendarEvent | null;
  /** Prochain cours non annulé qui n'a pas encore commencé (7 jours), null sans emploi du temps. */
  nextCourse: SchoolCourse | null;
  pendingTasks: number;
  /** Les premières tâches à faire (3 au plus). */
  nextTasks: string[];
  /** Mots pas encore vus, laissés à ce profil. */
  unreadNotes: number;
  /** Avancement de la routine du moment, s'il y en a une. */
  routine: { period: RoutinePeriod; done: number; total: number } | null;
  /** Prochain jour qui a des devoirs pas encore faits (à partir de demain), null sans cahier de texte ou s'il n'y en a pas. */
  homework: { due: string; left: number } | null;
};

export type HomeData = {
  /** null si la météo n'est pas configurée ou indisponible. */
  weather: Weather | null;
  profiles: ProfileSummary[];
  familyHighlight: CalendarEvent | null;
  /** Vacances scolaires à annoncer aujourd'hui (proches, dernier jour, en cours) ; null sinon ou non configurées. */
  holiday: HolidayStatus | null;
};

/** GET /api/school/holidays : ce qu'on dit aujourd'hui et les périodes à venir (null : vacances non configurées). */
export type HolidaysData = {
  holiday: HolidayStatus | null;
  /** Zone du calendrier (« Zone B », « Corse »…). */
  zone: string | null;
  holidays: SchoolHoliday[] | null;
};

/** Calendrier choisi pour les vacances : une académie (nom officiel) ou une zone ; null : vacances désactivées. */
export type HolidayChoice = { academie: string } | { zone: 'A' | 'B' | 'C' } | null;

/** Une académie du calendrier officiel et sa zone (« Zone B », ou le nom du territoire : « Corse », « Réunion »…). */
export type Academie = { name: string; zone: string };

/** GET /api/school/holidays/settings (page « Vacances scolaires »). */
export type HolidaySettings = {
  choice: HolidayChoice;
  /** false : la page n'a jamais été enregistrée, le choix vient de homehub.yaml. */
  saved: boolean;
  academies: Academie[];
};

export type DashboardData = {
  ownerId: string;
  nextEvent: CalendarEvent | null;
  tasks: Task[];
  upcoming: CalendarEvent[];
  /** Tous les événements des 7 prochains jours (y compris ceux en cours), triés. */
  events: CalendarEvent[];
  /** Mots pas encore vus, du plus récent au plus ancien. */
  notes: Note[];
  weather: Weather | null;
  /** null si le profil n'a pas d'emploi du temps (ou s'il est indisponible). */
  school: SchoolDays | null;
  /** Devoirs à faire à partir d'aujourd'hui, par jour puis matière ; null sans cahier de texte (ou indisponible). */
  homework: Homework[] | null;
  /** Trajet du matin (heures et jours réglés), null en dehors ou sans trajet. */
  commute: Commute | null;
  /** Routine du moment (matin ou soir), null en dehors de ses heures ou sans routine. */
  routine: Routine | null;
  /** Comme sur l'accueil. Pendant les vacances, ni trajet du matin, ni cours, ni étapes de routine des jours d'école. */
  holiday: HolidayStatus | null;
};

/** Minuteur de la maison, visible sur la tablette (et en veille). */
export type Timer = {
  id: string;
  /** « Cuisson », « Écrans »… ; vide : « Minuteur ». */
  label: string;
  durationSeconds: number;
  startedAt: string;
  endsAt: string;
  startedBy: Author;
};

/** Nombre de semaines consultables après la semaine en cours (limité par la fenêtre des emplois du temps). */
export const WEEKS_AHEAD = 2;

/** Durée maximale d'un minuteur : 24 h (la roue de la tablette s'y arrête). */
export const TIMER_MAX_SECONDS = 24 * 3600;

/** Agenda et cours d'un profil sur la semaine affichée. */
export type WeekOwner = {
  ownerId: string;
  events: CalendarEvent[];
  /** null si le profil n'a pas d'emploi du temps (ou s'il est indisponible). */
  courses: SchoolCourse[] | null;
};

/** Semaine détaillée : tous les profils, le front choisit lesquels afficher. */
export type WeekData = {
  /** Lundi, minuit local, ISO 8601. */
  start: string;
  /** 0 : semaine en cours ; 1 à WEEKS_AHEAD : les suivantes. */
  offset: number;
  owners: WeekOwner[];
};

export type Health = {
  status: 'ok';
  version: string;
  /** Même valeur que PublicConfig.revision : le front se recharge quand elle change. */
  configRevision: string;
  time: string;
};

/** Résultat d'un contrôle de santé du NAS (scripts/healthcheck.sh de nas-config). */
export type NasCheck = { level: 'OK' | 'WARN' | 'CRIT'; check: string; detail: string };

/** Relevé du NAS écrit toutes les 5 minutes par scripts/nas-status.sh (nas-config) dans nas-status.json. */
export type NasStatus = {
  generatedAt: string;
  hostname: string | null;
  version: string | null;
  uptimeSeconds: number | null;
  bootTime: string | null;
  cpu: { percent: number | null; load1: number | null; temperatureC: number | null };
  fanRpm: number | null;
  memory: { totalBytes: number; availableBytes: number; swapTotalBytes: number; swapUsedBytes: number };
  /** null : pas de batterie. */
  battery: { percent: number; status: string | null; healthPercent: number | null; onAc: boolean } | null;
  pools: {
    name: string;
    status: string;
    healthy: boolean;
    sizeBytes: number;
    allocatedBytes: number;
    /** Faux pour un disque seul : aucune copie en cas de panne. */
    redundant: boolean;
    lastScrub: { end: string; errors: number | null } | null;
  }[];
  disks: { name: string; model: string | null; temperatureC: number | null }[];
  checks: NasCheck[];
  backup: { at: string; result: string } | null;
  /** Conteneurs regroupés par service ; null si leur état est inconnu. */
  services: { label: string; running: number; total: number }[] | null;
};

/** État d'une source de données de HomeHub (agenda, météo, emploi du temps) d'après son dernier chargement. */
export type SourceState = {
  name: string;
  ok: boolean;
  /** Dernier chargement (réussi ou non), ISO 8601. */
  at: string;
  /** En échec : message de la dernière erreur, et début de la série d'échecs. */
  error?: string;
  failingSince?: string;
};

/** Page « Le NAS ». */
export type NasData = {
  /** null : relevé absent ou illisible. */
  status: NasStatus | null;
  sources: SourceState[];
  homehub: { version: string; startedAt: string };
};

/** Qui a fait un ajout ou coché un élément : la tablette (profil ouvert, s'il y en a un) ou un téléphone appairé. */
export type Author = { ownerId: string | null; via: 'tablet' | 'phone' };

/** Article de la liste de courses. Coché : « dans le panier », jusqu'à « Vider ». */
export type ShoppingItem = {
  id: string;
  label: string;
  done: boolean;
  addedBy: Author;
  addedAt: string;
  doneBy?: Author;
  doneAt?: string;
  /** Ligne venue du menu de la semaine : recalculée quand le menu change, tant qu'elle n'est pas cochée. */
  menu?: ShoppingMenuMark;
};

/**
 * Ce qu'une ligne du menu représente : un ingrédient (clé normalisée) pour une semaine (lundi), la quantité à
 * acheter par grandeur (voir shared/quantities.ts) et les recettes d'où il vient.
 */
export type ShoppingMenuMark = {
  week: string;
  key: string;
  /** Grandeur → quantité dans son unité de base (g, ml, c. à c., ou l'unité elle-même). */
  quantities: Partial<Record<string, number>>;
  /** Sans quantité (« persil ») : à acheter quand même. */
  toTaste: boolean;
  aisle: string | null;
  /** Titres des recettes (« Mijoté de lentilles ×2 »). */
  sources: string[];
  /** À vérifier au placard : un paquet peut-être entamé comblerait le manque (en cas de doute, on achète). */
  check?: boolean;
  /** Paquets à acheter, d'après le produit relié à l'ingrédient (« 2 × 200 g »). */
  packs?: { count: number; per: { quantity: number; unit: Unit } };
};

/**
 * Part fraîche d'un repas tardif du menu, pas encore sur la liste : elle la rejoint d'elle-même le jour `day`
 * (« À acheter plus tard »), ou plus tôt avec « Acheter maintenant ».
 */
export type ShoppingLater = {
  week: string;
  key: string;
  /** « Crème fraîche · 20 cl ». */
  label: string;
  /** Jour où l'acheter (AAAA-MM-JJ). */
  day: string;
  aisle: string | null;
  sources: string[];
};

export type Repeat ={ every: number; unit: 'day' | 'week' };

/** Tâche de la famille, pour un membre ou pour FAMILY_ID. */
export type ListTask = {
  id: string;
  label: string;
  ownerId: string;
  /** Échéance, jour local AAAA-MM-JJ ; null : sans date. */
  due: string | null;
  /** Tâche qui revient : une fois faite, la suivante est créée à la prochaine échéance. */
  repeat: Repeat | null;
  done: boolean;
  addedBy: Author;
  addedAt: string;
  doneBy?: Author;
  doneAt?: string;
};

/** Listes de la famille : ce qui est à faire, et ce qui a été fait aujourd'hui. */
export type Lists = {
  shopping: ShoppingItem[];
  tasks: ListTask[];
  /** Articles souvent achetés et absents de la liste, du plus fréquent au moins fréquent. */
  frequent: string[];
  /** Frais du menu à acheter plus tard (absent : pas de menu relié). */
  later?: ShoppingLater[];
};

/** Téléphone appairé : il agit au nom d'un seul profil. */
export type Device = {
  id: string;
  ownerId: string;
  /** Modèle annoncé par le téléphone (code brut sur Android), ou nom choisi sur la tablette. */
  name: string;
  /** Système annoncé à l'appairage (« Android 15 », « iOS 18 »), s'il est connu. */
  system?: string | null;
  pairedAt: string;
  lastSeenAt: string;
};

/** Ce que peut faire l'appareil qui appelle l'API. */
export type Me = {
  /** Tablette de la maison (adresse listée dans la configuration) : peut modifier les listes et appairer. */
  kiosk: boolean;
  /** Téléphone appairé, ou null. */
  device: Device | null;
};

export type PairingCode = { code: string; ownerId: string; expiresAt: string };

// --- Stock de la maison : produits scannés (code-barres), quantités, contenants ---

/** Ce qu'on sait d'un produit : lu dans la base (Open Food Facts…) ou saisi à la main. */
export type ProductInfo = {
  name: string;
  brand: string | null;
  /** Contenance telle qu'écrite sur le paquet (« 4 x 90 g », « 1,5 L »). */
  quantity: string | null;
  /** Rayon, choisi à la main (« Frais », « Entretien »…). */
  category: string | null;
};

/** Version datée d'un produit : un même code-barres peut changer (contenance réduite…). */
export type ProductVersion = ProductInfo & {
  /** Version en vigueur depuis. */
  from: string;
  source: 'base' | 'manual';
  /** Base consultée (open-food-facts, open-beauty-facts, open-products-facts) ; null : saisie à la main. */
  base: string | null;
};

export type Product = {
  /** Code-barres sur 13 chiffres (EAN-13 ; UPC-A et EAN-8 complétés de zéros). */
  code: string;
  current: ProductVersion;
  versionCount: number;
  image: string | null;
  /** Ajouter à la liste de courses quand il est épuisé : oui, non, ou null (réglage par défaut du stock). */
  autoShop: boolean | null;
  /** Contenant dans lequel on le transvase d'habitude (recharge de lessive…), proposé d'office. */
  refill: string | null;
  /** Relecture de la base qui contredit notre correction : à trancher (rien n'a changé). */
  conflict: ProductInfo | null;
  /** Dernière lecture de la base, s'il y en a eu une. */
  baseReadAt: string | null;
  /** Catégories Open Food Facts copiées à la lecture de la base (« en:milks »…) ; null : jamais copiées. */
  categories: string[] | null;
};

/** Contenant de la maison (bidon de lessive, bocal à farine…), avec son étiquette à code-barres. */
export type Container = {
  id: string;
  code: string;
  name: string;
  /** Produit qu'il contient (le dernier transvasé), s'il y en a un. */
  productCode: string | null;
  productName: string | null;
  full: boolean;
};

/** Quand et par qui (profil du téléphone, personne reconnue devant la tablette, ou personne : ownerId null). */
export type StockMark = { at: string; by: Author };

export type StockEntry = {
  product: Product;
  quantity: number;
  updatedAt: string | null;
  /** Dernière entrée (rangé, + 1) et dernière sortie (jeté, transvasé, contenant vidé), hors mouvements annulés. */
  lastIn: StockMark | null;
  lastOut: StockMark | null;
  /** Part restante du paquet entamé (¼ · ½ · ¾), notée en cuisinant ; null : inconnue. */
  opened: number | null;
};

/** Entrée ou sortie du stock, pour l'historique d'un produit. `count` : unités ; pour « adjust », la nouvelle quantité. */
export type StockMovement = StockMark & {
  id: string;
  /** « opened » : paquet entamé, part restante notée en cuisinant (aucun paquet ne sort). */
  kind: 'in' | 'out' | 'refill' | 'adjust' | 'container-empty' | 'opened';
  count: number;
  price: number | null;
  forgotten: boolean;
  undone: boolean;
  /** Raison écrite dans l'historique (« Cuisiné : Pâtes au thon »), sinon null. */
  reason: string | null;
  /** Part restante notée (mouvement « opened », ou sortie suivie d'un paquet entamé), sinon null. */
  opened: number | null;
};

export type StockData = {
  /** Produits connus, en stock d'abord, puis épuisés. */
  items: StockEntry[];
  containers: Container[];
  settings: StockSettings;
};

export type StockSettings = {
  /** Produit épuisé : l'ajouter à la liste de courses sans demander (sauf réglage du produit). */
  autoShop: boolean;
};

/** Ce qu'est un code-barres scanné. */
export type ScanLookup =
  | { kind: 'product'; code: string; product: Product; quantity: number }
  | { kind: 'container'; code: string; container: Container }
  /** Inconnu partout : à saisir ; `suggestion` : ce que la base sait quand même (sans nom). */
  | { kind: 'unknown'; code: string; suggestion: Partial<ProductInfo> | null; baseError: boolean };

/** Ce que devient la liste de courses après une sortie : ajouté d'office, à proposer, ou rien à faire. */
export type ShoppingOutcome = 'added' | 'propose' | 'none';

export type StockMovementResult = StockMark & {
  movementId: string;
  product: Product | null;
  quantity: number;
  container: Container | null;
  /** Sortie d'un produit qu'on n'avait pas en stock : l'entrée avait été oubliée. */
  forgotten: boolean;
  shopping: ShoppingOutcome;
  /** Libellé proposé (ou ajouté) à la liste de courses. */
  shoppingLabel: string | null;
};

/** « Revérifier » : ce que dit la base maintenant, à côté de la version en vigueur. */
export type ProductRecheck = { current: ProductInfo; base: ProductInfo | null; differs: boolean; baseError: boolean };

// --- Échanges de l'API : corps envoyés et réponses, écrits une fois pour le serveur et le client (web/src/lib/api.ts) ---

/** Nouvelle tâche (POST /api/lists/tasks). */
export type NewTask = { label: string; ownerId: string; due: string | null; repeat: Repeat | null };

/** Sortie du stock (POST /api/stock/out) : tout d'un coup, transvasée dans un contenant, ou entrée oubliée. */
export type StockOutOptions = { all?: boolean; refill?: string | null; remaining?: number };

/** Préférences d'un produit : liste de courses d'office (null : réglage du stock), contenant habituel. */
export type ProductPreferences = { autoShop?: boolean | null; refill?: string | null };

/** Analyse d'un visage par la tablette : empreinte, et scores contre une photo (`real`) ou un écran (`live`). */
export type FaceReadingInput = { embedding: number[]; real: number; live: number };

/** Ressemblance avec une personne enregistrée (0 à 1). */
export type FaceScore = { ownerId: string; score: number };

/** Seuils de la reconnaissance (faces.* de homehub.yaml). */
export type FaceThresholds = { threshold: number; margin: number; antispoof: number; liveness: number };

/**
 * Verdict d'une analyse : `ok`, ou la raison du refus (`photo` : score contre une photo trop bas ; `screen` : contre
 * un écran ; `none` : aucun visage enregistré ; `low` : ressemblance sous le seuil ; `close` : trop proche de la
 * personne suivante pour trancher).
 */
export type FaceVerdict = {
  result: 'ok' | 'photo' | 'screen' | 'none' | 'low' | 'close';
  /** Personne la plus ressemblante, et sa ressemblance ; `next` : celle de la suivante. */
  ownerId: string | null;
  score: number;
  next: number;
};

/** Diagnostic d'une analyse (POST /api/faces/diagnose) : verdict, ressemblances et seuils en vigueur. */
export type FaceDiagnosis = { scores: FaceScore[]; verdict: FaceVerdict; rules: FaceThresholds };

/**
 * Personne reconnue (POST /api/faces/identify) : sa session, présentée ensuite dans X-Actor-Session. `expiresAt` :
 * seulement pour une session nouvelle (celle qui est présentée et prolongée n'en renvoie pas).
 */
export type FaceSession = { ownerId: string; token: string; expiresAt?: string };

/**
 * Empreintes enregistrées et apprises, par personne ; `uniform` : enregistrées anormalement semblables (tablette qui
 * calculait mal les empreintes, voir shared/faces.ts) : à effacer et refaire.
 */
export type FaceCounts = Record<string, { enrolled: number; learned: number; uniform: boolean }>;

/** Visages connus de la tablette (GET /api/faces). */
export type FacesOverview = { enrolled: string[]; samples: FaceCounts };
