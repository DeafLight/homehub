// Appli du téléphone (/m), sans navigateur : les onglets selon le profil, les mots reçus et ce qui reste à voir.
// Phone.svelte ne garde que les données, les appels et l'affichage.
import { canWrite } from '../../../shared/rights.ts';
import { FAMILY_ID, type Member, type Note, type PublicConfig } from '../../../shared/types.ts';
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

/**
 * Message écrit à la télé : par l'appli tierce configurée (`tv.host`), ou par une télé appairée avec l'appli HomeHub
 * TV (`screens` : il y en a au moins une).
 */
export const hasTvMessage = (config: Pick<PublicConfig, 'tv'>, screens: boolean) => config.tv || screens;

/**
 * Onglet Caméra : pour un parent, dès qu'il y a la caméra en direct ou une télé qui reçoit les messages (le serveur
 * revérifie chaque appel). `screens` : une télé est appairée avec l'appli HomeHub TV.
 */
export const hasCameraTab = (member: Pick<Member, 'parent'> | undefined, config: Pick<PublicConfig, 'camera' | 'tv'>, screens = false) =>
  Boolean(member?.parent && (config.camera.live || hasTvMessage(config, screens)));

/** Mots reçus (pour moi ou pour toute la famille, sauf les miens) : ceux pas encore vus d'abord. */
export function receivedNotes(notes: Note[], meId: string): Note[] {
  return notes
    .filter((n) => (n.to === meId || n.to === FAMILY_ID) && n.from.ownerId !== meId)
    .sort((a, b) => Number(Boolean(a.seenAt)) - Number(Boolean(b.seenAt)));
}

/** « Vu » : sur les mots de mon profil ; ceux de toute la famille, seulement pour un parent. */
export const canMarkSeen = (member: Pick<Member, 'id' | 'parent'> | undefined, note: Note) => member !== undefined && canWrite(member, note.to);

/** Croix « Supprimer le mot » : un mot déjà vu, avec les mêmes droits que « Vu » (le serveur revérifie). */
export const canRemoveNote = (member: Pick<Member, 'id' | 'parent'> | undefined, note: Note) => Boolean(note.seenAt) && canMarkSeen(member, note);

/** Pastille de l'onglet Mots : mots pas encore vus que je peux marquer vus. */
export const unseenCount = (received: Note[], member: Pick<Member, 'id' | 'parent'> | undefined) =>
  received.filter((n) => !n.seenAt && canMarkSeen(member, n)).length;
