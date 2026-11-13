// Appli du téléphone (/m), sans navigateur : les onglets selon le profil, les mots reçus et ce qui reste à voir.
// Phone.svelte ne garde que les données, les appels et l'affichage.
import { canWrite } from '../../../shared/rights.ts';
import { FAMILY_ID, type Member, type Note } from '../../../shared/types.ts';
import type { IconName } from '../components/Icon.svelte';
import type { PhoneTab } from './route.ts';

export type PhoneTabItem = { tab: PhoneTab; label: string; icon: IconName };

/**
 * Onglets du bas : Recettes pour tous ; Sport seulement pour un profil qui a un programme ; Caméra pour un parent,
 * quand la caméra en direct est activée (le serveur le revérifie).
 */
export function phoneTabs(hasFitness: boolean, camera = false): PhoneTabItem[] {
  return [
    { tab: 'shopping', label: 'Courses', icon: 'cart' },
    { tab: 'tasks', label: 'Tâches', icon: 'check' },
    { tab: 'agenda', label: 'Agenda', icon: 'calendar' },
    { tab: 'notes', label: 'Mots', icon: 'message' },
    { tab: 'recipes', label: 'Recettes', icon: 'book' },
    ...(hasFitness ? [{ tab: 'sport' as const, label: 'Sport', icon: 'dumbbell' as const }] : []),
    ...(camera ? [{ tab: 'camera' as const, label: 'Caméra', icon: 'video' as const }] : []),
  ];
}

/** Mots reçus (pour moi ou pour toute la famille, sauf les miens) : ceux pas encore vus d'abord. */
export function receivedNotes(notes: Note[], meId: string): Note[] {
  return notes
    .filter((n) => (n.to === meId || n.to === FAMILY_ID) && n.from.ownerId !== meId)
    .sort((a, b) => Number(Boolean(a.seenAt)) - Number(Boolean(b.seenAt)));
}

/** « Vu » : sur les mots de mon profil ; ceux de toute la famille, seulement pour un parent. */
export const canMarkSeen = (member: Pick<Member, 'id' | 'parent'> | undefined, note: Note) => member !== undefined && canWrite(member, note.to);

/** Pastille de l'onglet Mots : mots pas encore vus que je peux marquer vus. */
export const unseenCount = (received: Note[], member: Pick<Member, 'id' | 'parent'> | undefined) =>
  received.filter((n) => !n.seenAt && canMarkSeen(member, n)).length;
