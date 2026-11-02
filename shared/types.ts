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

export type Health = {
  status: 'ok';
  version: string;
  /** Même valeur que PublicConfig.revision : le front se recharge quand elle change. */
  configRevision: string;
  time: string;
};
