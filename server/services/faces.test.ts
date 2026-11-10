// Tests de la reconnaissance faciale sans HTTP : verdict sur les membres actuels, session, apprentissage, journal sobre.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createActorSessions, createFaceStore } from '../sources/faces.ts';
import { NOW } from '../testing.ts';
import { createFaceRecognition, type FaceRulesConfig } from './faces.ts';

const RULES: FaceRulesConfig = { threshold: 0.55, margin: 0.05, antispoof: 0.2, liveness: 0.2, sessionMinutes: 10, learnMinutes: 30 };
/** Empreintes de test : 64 valeurs égales. Alex à 0, Léa à 5 : très différents ; à 20, personne. */
const face = (value: number) => Array.from({ length: 64 }, () => value);
const reading = (value: number, real = 0.9, live = 0.9) => ({ embedding: face(value), real, live });

async function setup(members = ['alex', 'lea']) {
  let now = new Date(NOW);
  const clock = () => new Date(now);
  const faces = createFaceStore({ path: join(mkdtempSync(join(tmpdir(), 'homehub-faces-')), 'faces.json') });
  await faces.enroll('alex', [face(0)]);
  await faces.enroll('lea', [face(5)]);
  const sessions = createActorSessions(clock);
  const logs: string[] = [];
  const recognition = createFaceRecognition({
    faces,
    sessions,
    household: { isMember: (id) => members.includes(id) },
    rules: () => RULES,
    clock,
    logger: { info: (message: string) => void logs.push(message) },
  });
  const advance = (ms: number) => (now = new Date(now.getTime() + ms));
  return { recognition, sessions, faces, logs, advance };
}

describe('createFaceRecognition', () => {
  it('reconnaît la personne et ouvre une session, prolongée tant que c’est elle', async () => {
    const { recognition, sessions } = await setup();
    const first = await recognition.identify(reading(0), undefined);
    expect(first).toMatchObject({ ok: true, ownerId: 'alex' });
    const token = (first as { token: string }).token;
    expect(sessions.get(token, 10)).toBe('alex');
    expect(await recognition.identify(reading(0), token)).toEqual({ ok: true, ownerId: 'alex', token });
  });

  it('une autre personne ferme la session présentée et en ouvre une nouvelle', async () => {
    const { recognition, sessions } = await setup();
    const alex = (await recognition.identify(reading(0), undefined)) as { token: string };
    const lea = (await recognition.identify(reading(5), alex.token)) as { ownerId: string; token: string };
    expect(lea.ownerId).toBe('lea');
    expect(lea.token).not.toBe(alex.token);
    expect(sessions.get(alex.token, 10)).toBeNull();
  });

  it('refuse une photo ou un écran (« approche-toi »), et un visage inconnu', async () => {
    const { recognition } = await setup();
    expect(await recognition.identify(reading(0, 0.05), undefined)).toEqual({ ok: false, far: true });
    expect(await recognition.identify(reading(0, 0.9, 0.05), undefined)).toEqual({ ok: false, far: true });
    expect(await recognition.identify(reading(20), undefined)).toEqual({ ok: false, far: false });
  });

  it('ne reconnaît plus un profil retiré de la configuration', async () => {
    const { recognition } = await setup(['lea']);
    expect((await recognition.identify(reading(0), undefined)).ok).toBe(false);
  });

  it('journalise un refus toutes les 10 s au plus', async () => {
    const { recognition, logs, advance } = await setup();
    await recognition.identify(reading(20), undefined);
    await recognition.identify(reading(20), undefined);
    advance(10_000);
    await recognition.identify(reading(20), undefined);
    expect(logs.filter((l) => l.includes('non reconnu'))).toHaveLength(2);
  });

  it('apprend une empreinte sûre au plus une fois par période', async () => {
    const { recognition, faces, advance } = await setup();
    // Ressemblance 0,7 : assez sûre (seuil + 0,05, loin de Léa), assez nouvelle (sous 0,85) pour apprendre.
    const near = { embedding: face(0).map((_, i) => (i % 2 ? 0.95 : -0.95)), real: 0.9, live: 0.9 };
    // Une autre, aussi loin de l'empreinte enregistrée que de celle qui vient d'être apprise.
    const other = { ...near, embedding: near.embedding.map((v) => -v) };
    const learned = async () => (await faces.counts()).alex.learned;
    expect((await recognition.diagnose(near)).verdict.score).toBe(0.7);
    await recognition.identify(near, undefined);
    expect(await learned()).toBe(1);
    advance(RULES.learnMinutes * 60_000 - 1);
    await recognition.identify(other, undefined);
    expect(await learned()).toBe(1);
    advance(1);
    await recognition.identify(other, undefined);
    expect(await learned()).toBe(2);
  });

  it('diagnostic : verdict, ressemblances et seuils, sans session', async () => {
    const { recognition } = await setup();
    const diagnosis = await recognition.diagnose(reading(0));
    expect(diagnosis.verdict).toMatchObject({ result: 'ok', ownerId: 'alex' });
    expect(diagnosis.scores.map((s) => s.ownerId)).toEqual(['alex', 'lea']);
    expect(diagnosis.rules).toEqual({ threshold: 0.55, margin: 0.05, antispoof: 0.2, liveness: 0.2 });
  });
});
