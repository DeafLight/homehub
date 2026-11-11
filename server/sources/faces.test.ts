import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createActorSessions, createFaceStore, judge, MAX_LEARNED, MAX_SAMPLES, similarity, worthLearning } from './faces.ts';
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
    expect(await reread.scores(face(1))).toEqual([
      { ownerId: 'alex', score: 1 },
      { ownerId: 'tom', score: 0 },
    ]);
    // Les prises d'Alex sont toutes identiques : signalées comme anormales.
    expect(await reread.counts()).toEqual({
      alex: { enrolled: MAX_SAMPLES, learned: 0, uniform: true },
      tom: { enrolled: 1, learned: 0, uniform: false },
    });
    expect(await reread.remove('tom')).toBe(true);
    expect(await reread.remove('tom')).toBe(false);
    expect(await createFaceStore({ path: `${path}.absent` }).scores(face(1))).toEqual([]);
  });

  it('empreintes apprises : comptées dans la ressemblance, limitées, effacées avec le visage', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'homehub-faces-')), 'faces.json');
    const store = createFaceStore({ path });
    await store.learn('alex', face(-0.2)); // pas encore enregistré : ignorée
    await store.enroll('alex', [face(1)]);
    expect((await store.scores(face(-0.2)))[0].score).toBeLessThan(1);
    for (let i = 0; i < MAX_LEARNED + 3; i++) await store.learn('alex', face(-0.2));
    const reread = createFaceStore({ path });
    expect(await reread.scores(face(-0.2))).toEqual([{ ownerId: 'alex', score: 1 }]);
    expect(await reread.counts()).toEqual({ alex: { enrolled: 1, learned: MAX_LEARNED, uniform: false } });
    await reread.remove('alex');
    await reread.enroll('alex', [face(1)]);
    expect(await reread.counts()).toEqual({ alex: { enrolled: 1, learned: 0, uniform: false } });
  });

  it('verdict : photo, écran, seuil, marge ; apprentissage seulement sur une reconnaissance sûre et nouvelle', () => {
    const rules = { threshold: 0.55, margin: 0.05, antispoof: 0.2, liveness: 0.2 };
    const scores = (a: number, b?: number) => [{ ownerId: 'alex', score: a }, ...(b === undefined ? [] : [{ ownerId: 'tom', score: b }])];
    const real = { real: 0.9, live: 0.9 };
    expect(judge(real, scores(0.7, 0.4), rules)).toEqual({ result: 'ok', ownerId: 'alex', score: 0.7, next: 0.4 });
    expect(judge({ real: 0.1, live: 0.9 }, scores(0.7), rules).result).toBe('photo');
    expect(judge({ real: 0.9, live: 0.1 }, scores(0.7), rules).result).toBe('screen');
    expect(judge(real, [], rules)).toEqual({ result: 'none', ownerId: null, score: 0, next: 0 });
    expect(judge(real, scores(0.5), rules).result).toBe('low');
    expect(judge(real, scores(0.7, 0.67), rules).result).toBe('close');

    expect(worthLearning(judge(real, scores(0.7, 0.4), rules), rules)).toBe(true);
    expect(worthLearning(judge(real, scores(0.57, 0.3), rules), rules)).toBe(false); // trop près du seuil
    expect(worthLearning(judge(real, scores(0.9, 0.3), rules), rules)).toBe(false); // déjà bien connue
    expect(worthLearning(judge(real, scores(0.7, 0.62), rules), rules)).toBe(false); // marge trop juste
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
