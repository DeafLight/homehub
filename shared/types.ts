// Contrat de l'API, partagé entre le serveur et le front.
// Types et constantes uniquement, sans dépendance : il est importé des deux côtés.

/** Identifiant réservé au dashboard commun de la famille. */
export const FAMILY_ID = 'famille';

export type Member = {
  id: string;
  name: string;
  /** Couleur d'accent, au format #rrggbb. */
  color: string;
};

/** Configuration visible par le front (aucun secret). */
export type PublicConfig = {
  members: Member[];
  family: { name: string };
  ui: { idleTimeoutSeconds: number };
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

export type Note = {
  text: string;
  /** Identifiant du membre qui a laissé le mot. */
  authorId: string;
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

/** Résumé d'un profil (un membre, ou la famille) pour l'écran d'accueil. */
export type ProfileSummary = {
  ownerId: string;
  nextEvent: CalendarEvent | null;
  /** Prochain cours non annulé qui n'a pas encore commencé (7 jours), null sans emploi du temps. */
  nextCourse: SchoolCourse | null;
  pendingTasks: number;
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
  note: Note | null;
  weather: Weather | null;
  /** null si le profil n'a pas d'emploi du temps (ou s'il est indisponible). */
  school: SchoolDays | null;
};

/** Nombre de semaines consultables après la semaine en cours (limité par la fenêtre des emplois du temps). */
export const WEEKS_AHEAD = 2;

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
export type Device = { id: string; ownerId: string; name: string; pairedAt: string; lastSeenAt: string };

/** Ce que peut faire l'appareil qui appelle l'API. */
export type Me = {
  /** Tablette de la maison (adresse listée dans la configuration) : peut modifier les listes et appairer. */
  kiosk: boolean;
  /** Téléphone appairé, ou null. */
  device: Device | null;
};

export type PairingCode = { code: string; ownerId: string; expiresAt: string };
