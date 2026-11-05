// Contrat de l'API, partagé entre le serveur et le front.
// Types et constantes uniquement, sans dépendance : il est importé des deux côtés.

/** Identifiant réservé au dashboard commun de la famille. */
export const FAMILY_ID = 'famille';

export type Member = {
  id: string;
  name: string;
  /** Couleur d'accent, au format #rrggbb. */
  color: string;
  /** Parent : écrit sur tous les profils ; sinon (enfant), seulement sur le sien. */
  parent: boolean;
};

/** Configuration visible par le front (aucun secret). */
export type PublicConfig = {
  members: Member[];
  family: { name: string };
  ui: { idleTimeoutSeconds: number; screensaverMinutes: number };
  /** Détection des visages sur la tablette (voir `faces` dans homehub.yaml). */
  faces: { minConfidence: number; minSize: number };
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
};

export type Repeat = { every: number; unit: 'day' | 'week' };

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
