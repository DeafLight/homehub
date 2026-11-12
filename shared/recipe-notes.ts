// Notes et commentaires de la famille sur une recette (« moins salé la prochaine fois », « Tom n'aime pas les
// champignons »), partagés entre le serveur et le front : leur forme, leurs limites, l'ordre d'affichage (ouvertes
// d'abord, de la plus ancienne à la plus récente, puis les résolues), et qui peut les modifier. Une note résolue reste
// consultable, repliée, et se rouvre. Le carnet est familial : rien de personnel, mais chaque note est signée.
import { canWrite } from './rights.ts';
import type { Author, Member } from './types.ts';

export const RECIPE_NOTE_LIMITS = {
  /** Caractères d'une note. */
  text: 1000,
  /** Notes par recette, résolues comprises : au-delà, retirer les anciennes. */
  perRecipe: 100,
} as const;

/** Auteur d'une note : toujours quelqu'un d'identifié (son téléphone, ou reconnu à la tablette). */
export type NoteAuthor = Author & { ownerId: string };

export type RecipeNote = {
  id: string;
  recipeId: string;
  text: string;
  by: NoteAuthor;
  at: string;
  /** Texte modifié après coup (par son auteur ou un parent). */
  editedAt?: string;
  editedBy?: NoteAuthor;
  /** Marquée résolue : repliée sur la fiche, absente du mode cuisine, toujours consultable. */
  resolvedAt?: string;
  resolvedBy?: NoteAuthor;
};

/** Modification d'une note : son texte, ou son état (résolue, rouverte). */
export type NotePatch = { text?: string; resolved?: boolean };

export const isOpen = (note: Pick<RecipeNote, 'resolvedAt'>) => note.resolvedAt === undefined;

/** Ouvertes, de la plus ancienne à la plus récente (on lit dans l'ordre) ; résolues, la dernière résolue d'abord. */
export function splitNotes<T extends RecipeNote>(notes: readonly T[]): { open: T[]; resolved: T[] } {
  const open = notes.filter(isOpen).sort((a, b) => a.at.localeCompare(b.at));
  const resolved = notes.filter((n) => !isOpen(n)).sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
  return { open, resolved };
}

/** Texte d'une note : espaces de bord retirés, trois retours à la ligne au plus de suite. */
export function cleanNoteText(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** Qui modifie, résout ou retire une note : son auteur, ou un parent (règle commune du profil, `canWrite`). */
export const canChangeNote = (member: Pick<Member, 'id' | 'parent'> | undefined, note: Pick<RecipeNote, 'by'>) =>
  member !== undefined && canWrite(member, note.by.ownerId);

/** Pastille discrète : « 1 note », « 3 notes » (ouvertes seulement). */
export const notesBadge = (open: number) => (open <= 0 ? null : open === 1 ? '1 note' : `${open} notes`);
