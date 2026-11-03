// Ports vers les sources de données. Chaque widget dépend d'une interface, pas d'une implémentation :
// les données d'exemple d'aujourd'hui seront remplacées une par une (agenda Google, météo, Immich...)
// sans toucher au service ni aux routes.
import type { CalendarEvent, Note, SchoolCourse, Task, Weather, WeatherForecast } from '../../shared/types.ts';

/** Horloge injectable, pour des tests déterministes. */
export type Clock = () => Date;

export type TimeRange = { from: Date; to: Date };

/** `ownerId` désigne un membre, ou FAMILY_ID pour la famille. */
export interface AgendaSource {
  /**
   * Événements qui commencent dans l'intervalle, triés par date de début. Un événement sur la journée ou sur
   * plusieurs jours est inclus tant qu'il n'est pas terminé (il reste visible jusqu'à sa fin).
   */
  eventsFor(ownerId: string, range: TimeRange): Promise<CalendarEvent[]>;
}

export interface TaskSource {
  tasksFor(ownerId: string): Promise<Task[]>;
  /** Renvoie la tâche mise à jour, ou null si elle n'existe pas. */
  setDone(ownerId: string, taskId: string, done: boolean): Promise<Task | null>;
}

export interface NoteSource {
  latestFor(ownerId: string): Promise<Note | null>;
}

export interface WeatherSource {
  /** null si aucun lieu n'est configuré ; lève une erreur si la source est indisponible. */
  current(): Promise<Weather | null>;
  /** Prévision détaillée (page météo) ; mêmes règles que `current`. */
  forecast(): Promise<WeatherForecast | null>;
}

/** Les emplois du temps sont chargés du lundi de la semaine en cours, sur ce nombre de jours (page semaine : 3 semaines). */
export const SCHOOL_WINDOW_DAYS = 21;

/** Lundi de la semaine de `date`, à minuit (heure locale). */
export function startOfWeek(date: Date): Date {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export interface SchoolSource {
  /** Cours qui chevauchent l'intervalle, triés ; null si le profil n'a pas d'emploi du temps. */
  coursesFor(ownerId: string, range: TimeRange): Promise<SchoolCourse[] | null>;
}

/** Chaque profil a au plus un emploi du temps : le premier service qui le connaît répond (ÉcoleDirecte, Pronote...). */
export const firstSchoolSource = (...sources: SchoolSource[]): SchoolSource => ({
  async coursesFor(ownerId, range) {
    for (const source of sources) {
      const courses = await source.coursesFor(ownerId, range);
      if (courses) return courses;
    }
    return null;
  },
});

export type Sources = {
  agenda: AgendaSource;
  tasks: TaskSource;
  notes: NoteSource;
  weather: WeatherSource;
  school: SchoolSource;
};
