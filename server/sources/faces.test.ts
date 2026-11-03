import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createActorSessions, createFaceStore, MAX_SAMPLES, similarity } from './faces.ts';
import { NOW } from '../testing.ts';

const face = (value: number) => Array.from({ length: 64 }, () => value);

describe('visages', () => {
  it('ressemblance : 1 pour la même empreinte, 0 pour des empreintes opposées', () => {
    expect(similarity(face(0.5), face(0.5))).toBe(1);
    expect(similarity(face(1), face(-1))).toBe(0);
    expect(similarity(face(1), face(1).slice(1))).toBe(0);
  });

  it('garde les empreintes les plus récentes, relues depuis le fichier', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'homehub-faces-')), 'faces.json');
    const store = createFaceStore({ path });
    await store.enroll('alex', Array.from({ length: MAX_SAMPLES + 2 }, () => face(1)));
    await store.enroll('tom', [face(-1)]);
    const reread = createFaceStore({ path });
    expect(await reread.enrolled()).toEqual(['alex', 'tom']);
    expect(await reread.closest(face(1))).toEqual({ ownerId: 'alex', score: 1, next: 0 });
    expect(await reread.remove('tom')).toBe(true);
    expect(await reread.remove('tom')).toBe(false);
    expect(await createFaceStore({ path: `${path}.absent` }).closest(face(1))).toBeNull();
  });

  it('session : prolongée à chaque usage, perdue après le délai ou fermée', () => {
    let now = new Date(NOW).getTime();
    const sessions = createActorSessions(() => new Date(now));
    const { token } = sessions.open('alex', 10);
    now += 9 * 60_000;
    expect(sessions.get(token, 10)).toBe('alex');
    now += 9 * 60_000;
    expect(sessions.get(token, 10)).toBe('alex');
    now += 11 * 60_000;
    expect(sessions.get(token, 10)).toBeNull();

    const second = sessions.open('tom', 10).token;
    sessions.close(second);
    expect(sessions.get(second, 10)).toBeNull();
    expect(sessions.get(undefined, 10)).toBeNull();
  });
});
