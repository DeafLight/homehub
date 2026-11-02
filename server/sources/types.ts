// Ports vers les sources de données. Chaque widget dépend d'une interface, pas d'une implémentation :
// les données d'exemple d'aujourd'hui seront remplacées une par une (agenda Google, météo, Immich...)
// sans toucher au service ni aux routes.
import type { CalendarEvent, Note, Task, Weather } from '../../shared/types.ts';

/** Horloge injectable, pour des tests déterministes. */
export type Clock = () => Date;

export type TimeRange = { from: Date; to: Date };

/** `ownerId` désigne un membre, ou FAMILY_ID pour la famille. */
export interface AgendaSource {
  /** Événements qui commencent dans l'intervalle, triés par date de début. */
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
  current(): Promise<Weather>;
}

export type Sources = {
  agenda: AgendaSource;
  tasks: TaskSource;
  notes: NoteSource;
  weather: WeatherSource;
};
