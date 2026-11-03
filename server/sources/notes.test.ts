import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Author } from '../../shared/types.ts';
import { NOW } from '../testing.ts';
import { createNotesStore, NOTE_KEPT_DAYS } from './notes.ts';

const TOM: Author = { ownerId: 'tom', via: 'phone' };
const TABLET_LEA: Author = { ownerId: 'lea', via: 'tablet' };

function setup() {
  let now = NOW;
  const path = join(mkdtempSync(join(tmpdir(), 'homehub-notes-')), 'notes.json');
  const store = createNotesStore({ path, clock: () => now });
  return { store, path, wait: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe('mots de la famille', () => {
  it('laissé, listé pour son destinataire, puis vu', async () => {
    const { store, path, wait } = setup();
    const first = await store.add('alex', 'Pense à ton goûter', TOM);
    wait(60_000);
    const second = await store.add('alex', 'Bravo pour le match !', TABLET_LEA);
    await store.add('famille', 'Pizza ce soir', TOM);

    expect((await store.unseenFor('alex')).map((n) => n.id)).toEqual([second.id, first.id]);
    expect(await store.unseenFor('tom')).toEqual([]);
    expect(await readFile(path, 'utf8')).toContain('Pense à ton goûter');

    expect(await store.markSeen(second.id, { ownerId: 'alex', via: 'tablet' })).toMatchObject({ seenBy: { ownerId: 'alex' } });
    expect((await store.unseenFor('alex')).map((n) => n.id)).toEqual([first.id]);
    expect((await store.list()).length).toBe(3);
    expect(await store.markSeen('inconnu', TOM)).toBeNull();
  });

  it('effacé au bout de quelques jours, même pas vu', async () => {
    const { store, wait } = setup();
    await store.add('alex', 'Vieux mot', TOM);
    wait(NOTE_KEPT_DAYS * 86_400_000);
    expect(await store.unseenFor('alex')).toEqual([]);
    expect(await store.list()).toEqual([]);
  });
});
