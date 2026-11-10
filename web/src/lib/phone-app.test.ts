// Tests de l'appli du téléphone : onglets selon le profil, mots reçus et pastille des mots à voir.
import { describe, expect, it } from 'vitest';
import { FAMILY_ID, type Note } from '../../../shared/types.ts';
import { canMarkSeen, phoneTabs, receivedNotes, unseenCount } from './phone-app.ts';

const note = (id: string, to: string, from: string | null, seenAt?: string): Note => ({ id, text: id, to, from: { ownerId: from, via: 'tablet' }, at: '2026-11-10T08:00:00Z', seenAt });
const lea = { id: 'lea', parent: false };
const alex = { id: 'alex', parent: true };

describe('appli du téléphone', () => {
  it('onglet Sport seulement avec un programme', () => {
    expect(phoneTabs(false).map((t) => t.tab)).toEqual(['shopping', 'tasks', 'agenda', 'notes']);
    expect(phoneTabs(true).at(-1)).toEqual({ tab: 'sport', label: 'Sport', icon: 'dumbbell' });
  });

  it('mots reçus : pour moi ou la famille, pas les miens, les nouveaux d’abord', () => {
    const notes = [note('vu', 'lea', 'alex', '2026-11-10T09:00:00Z'), note('famille', FAMILY_ID, null), note('moi', 'lea', 'sam'), note('autre', 'tom', 'alex'), note('mien', FAMILY_ID, 'lea')];
    expect(receivedNotes(notes, 'lea').map((n) => n.id)).toEqual(['famille', 'moi', 'vu']);
  });

  it('« Vu » : mes mots ; ceux de la famille pour un parent seulement', () => {
    expect(canMarkSeen(lea, note('a', 'lea', 'alex'))).toBe(true);
    expect(canMarkSeen(lea, note('a', FAMILY_ID, 'alex'))).toBe(false);
    expect(canMarkSeen(alex, note('a', FAMILY_ID, 'sam'))).toBe(true);
    expect(canMarkSeen(undefined, note('a', 'lea', 'alex'))).toBe(false);
  });

  it('pastille : mots pas vus que je peux marquer vus', () => {
    const received = [note('a', 'lea', 'alex'), note('b', FAMILY_ID, 'alex'), note('c', 'lea', 'sam', '2026-11-10T09:00:00Z')];
    expect(unseenCount(received, lea)).toBe(1);
    expect(unseenCount(received, alex)).toBe(2);
  });
});
