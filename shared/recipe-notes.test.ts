// Tests des règles des notes sur une recette : ordre d'affichage, texte nettoyé, qui modifie, pastille.
import { describe, expect, it } from 'vitest';
import { canChangeNote, cleanNoteText, isOpen, notesBadge, type RecipeNote, splitNotes } from './recipe-notes.ts';

const note = (id: string, at: string, extra: Partial<RecipeNote> = {}): RecipeNote => ({
  id,
  recipeId: 'r',
  text: id,
  by: { ownerId: 'tom', via: 'phone' },
  at,
  ...extra,
});

describe('notes sur une recette', () => {
  it('ouvertes de la plus ancienne à la plus récente, résolues ensuite (la dernière résolue d’abord)', () => {
    const notes = [
      note('b', '2026-11-03T10:00:00Z'),
      note('r1', '2026-11-01T10:00:00Z', { resolvedAt: '2026-11-02T10:00:00Z' }),
      note('a', '2026-11-02T10:00:00Z'),
      note('r2', '2026-10-01T10:00:00Z', { resolvedAt: '2026-11-04T10:00:00Z' }),
    ];
    const { open, resolved } = splitNotes(notes);
    expect(open.map((n) => n.id)).toEqual(['a', 'b']);
    expect(resolved.map((n) => n.id)).toEqual(['r2', 'r1']);
    expect(isOpen(notes[0])).toBe(true);
    expect(isOpen(notes[1])).toBe(false);
  });

  it('texte nettoyé : bords, fins de ligne, lignes vides en trop', () => {
    expect(cleanNoteText('  Moins salé  \r\n\r\n\r\n\r\nla prochaine fois\t \n ')).toBe('Moins salé\n\nla prochaine fois');
    expect(cleanNoteText(' \n\t')).toBe('');
  });

  it('son auteur ou un parent la modifie ; un autre enfant non', () => {
    const tomNote = note('a', '2026-11-02T10:00:00Z');
    expect(canChangeNote({ id: 'tom', parent: false }, tomNote)).toBe(true);
    expect(canChangeNote({ id: 'alex', parent: true }, tomNote)).toBe(true);
    expect(canChangeNote({ id: 'lea', parent: false }, tomNote)).toBe(false);
    expect(canChangeNote(undefined, tomNote)).toBe(false);
  });

  it('pastille : rien sans note ouverte', () => {
    expect(notesBadge(0)).toBeNull();
    expect(notesBadge(1)).toBe('1 note');
    expect(notesBadge(3)).toBe('3 notes');
  });
});
