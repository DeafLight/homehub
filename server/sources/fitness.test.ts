// Tests du magasin du programme de renforcement : séances notées, semaines, bilan du rythme et réglage des exercices.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAMILIES } from '../../shared/fitness-catalogue.ts';
import { PALIERS, emptyFitness, planSession, slotKey, slotTarget } from '../../shared/fitness.ts';
import { fixedClock, NOW } from '../testing.ts';
import { createFitnessStore } from './fitness.ts';

const tempPath = () => join(mkdtempSync(join(tmpdir(), 'homehub-fitness-')), 'fitness.json');
const report = { session: 1 as const, rpe: 3, stopped: false, note: null, exercises: [] };
const family = FAMILIES[0];

describe('séances', () => {
  it('note la séance avec le programme du jour et le rythme du moment, et la garde sur le disque', async () => {
    const path = tempPath();
    const store = createFitnessStore({ path, clock: fixedClock });
    await store.load();
    const state = await store.addSession('alex', {
      ...report,
      exercises: [{ family, rating: 'dur', pain: null, reps: 12, note: 'genou' }],
    });
    const [session] = state.sessions;
    const fresh = emptyFitness();
    expect(session).toMatchObject({ at: NOW.toISOString(), session: 1, palier: fresh.palier, rounds: PALIERS[fresh.palier].rounds, rpe: 3 });
    expect(session?.exercises.map((e) => e.exercise)).toEqual(planSession(fresh, 1).map((p) => p.exercise.id));
    expect(session?.exercises[0]).toMatchObject({ family, rating: 'dur', reps: 12, note: 'genou' });
    expect(session?.exercises[1]).toMatchObject({ rating: null, reps: null });

    const reread = createFitnessStore({ path, clock: fixedClock });
    await reread.load();
    expect(reread.get('alex').sessions).toHaveLength(1);
    expect(reread.get('lea')).toEqual(emptyFitness());
  });

  it('retire une séance ; une séance inconnue est refusée sans rien écrire', async () => {
    const store = createFitnessStore({ path: tempPath(), clock: fixedClock });
    await store.load();
    const id = (await store.addSession('alex', report)).sessions[0]?.id as string;
    expect(await store.removeSession('alex', 'inconnue')).toEqual({ error: 'Séance inconnue', status: 404 });
    expect(store.get('alex').sessions).toHaveLength(1);
    const result = await store.removeSession('alex', id);
    expect('state' in result && result.state.sessions).toEqual([]);
  });
});

describe('semaines', () => {
  it('attend le lundi de la semaine ; une semaine vide est retirée', async () => {
    const store = createFitnessStore({ path: tempPath(), clock: fixedClock });
    await store.load();
    expect(await store.setWeek('alex', '2026-11-03', { cardio: 30, waist: null })).toMatchObject({ status: 400 });
    expect(await store.setWeek('alex', 'lundi', { cardio: 30, waist: null })).toMatchObject({ status: 400 });
    await store.setWeek('alex', '2026-11-02', { cardio: 30, waist: 88 });
    expect(store.get('alex').weeks).toEqual({ '2026-11-02': { cardio: 30, waist: 88 } });
    await store.setWeek('alex', '2026-11-02', { cardio: null, waist: null });
    expect(store.get('alex').weeks).toEqual({});
  });
});

describe('rythme et exercices', () => {
  it('refuse un choix de rythme sans bilan en attente', async () => {
    const store = createFitnessStore({ path: tempPath(), clock: fixedClock });
    await store.load();
    expect(await store.chooseRhythm('alex', '2026-10-26', 'keep')).toMatchObject({ status: 409 });
  });

  it('« plus tard » retient la date ; un changement impossible est refusé', async () => {
    const store = createFitnessStore({ path: tempPath(), clock: fixedClock });
    await store.load();
    const result = await store.changeSlot('alex', 1, family, 'dismiss');
    expect('state' in result && result.state.slots[slotKey(1, family)]).toEqual({ offset: 0, swap: null, since: NOW.toISOString() });

    for (const change of ['easier', 'harder'] as const) {
      const possible = slotTarget(store.get('alex'), 1, family, change) !== null;
      const outcome = await store.changeSlot('alex', 1, family, change);
      expect('state' in outcome).toBe(possible);
      if (!possible) expect(outcome).toMatchObject({ status: 400 });
    }
  });
});
