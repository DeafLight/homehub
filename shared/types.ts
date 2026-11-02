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
  /** Début, ISO 8601. */
  start: string;
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
  temperatureC: number;
  condition: string;
  /** Une ligne de prévision (max, pluie…). */
  outlook: string;
};

/** Résumé d'un profil (un membre, ou la famille) pour l'écran d'accueil. */
export type ProfileSummary = {
  ownerId: string;
  nextEvent: CalendarEvent | null;
  pendingTasks: number;
};

export type HomeData = {
  weather: Weather;
  profiles: ProfileSummary[];
  familyHighlight: CalendarEvent | null;
};

export type DashboardData = {
  ownerId: string;
  nextEvent: CalendarEvent | null;
  tasks: Task[];
  upcoming: CalendarEvent[];
  note: Note | null;
  weather: Weather;
};

export type Health = {
  status: 'ok';
  version: string;
  /** Même valeur que PublicConfig.revision : le front se recharge quand elle change. */
  configRevision: string;
  time: string;
};
