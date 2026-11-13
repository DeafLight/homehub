// Filtre « Pour qui » des tâches : quels boutons de personne afficher et sur quel filtre ouvrir l'écran.
import type { ListTask } from '../../../shared/types.ts';

/** Tâches pas encore faites de cette personne (null : tout le monde). */
export const openTaskCount = (tasks: ListTask[], ownerId: string | null) =>
  tasks.filter((t) => !t.done && (!ownerId || t.ownerId === ownerId)).length;

/**
 * Personnes qui ont un bouton, dans l'ordre des profils : celles qui ont au moins une tâche (même faite), le filtre
 * en cours, et les personnes épinglées (la personne du téléphone, le profil d'origine sur la tablette), même sans
 * tâche, pour qu'on puisse toujours revenir à leur filtre après « Tous ».
 */
export function filterChips(
  profileIds: string[],
  tasks: ListTask[],
  filter: string | null,
  pinned: string[] = [],
): string[] {
  return profileIds.filter((id) => id === filter || pinned.includes(id) || tasks.some((t) => t.ownerId === id));
}

/** Filtre à l'ouverture : la personne si elle a une tâche à faire, sinon « Tous » plutôt qu'une liste vide. */
export function initialTaskFilter(tasks: ListTask[], ownerId: string | null): string | null {
  return ownerId && openTaskCount(tasks, ownerId) > 0 ? ownerId : null;
}
