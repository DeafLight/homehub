import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../testing.ts';
import { createRoutineStore, currentPeriod, stepKey, stepsOn } from './routines.ts';

const windows = { morning: { from: '05:00', to: '11:00' }, evening: { from: '17:00', to: '23:00' } };
const by = { ownerId: 'lea', via: 'tablet' as const };

describe('routines', () => {
  it('période du moment, selon les plages (fin exclue)', () => {
    expect(currentPeriod(new Date(2026, 10, 2, 4, 59), windows)).toBeNull();
    expect(currentPeriod(new Date(2026, 10, 2, 5, 0), windows)).toBe('morning');
    expect(currentPeriod(new Date(2026, 10, 2, 11, 0), windows)).toBeNull();
    expect(currentPeriod(new Date(2026, 10, 2, 18, 30), windows)).toBe('evening');
    expect(currentPeriod(new Date(2026, 10, 2, 23, 0), windows)).toBeNull();
  });

  it('heures du week-end, quand elles sont précisées', () => {
    const weekend = { ...windows, weekend: { morning: { from: '08:00', to: '12:00' } } };
    expect(currentPeriod(new Date(2026, 10, 7, 7, 0), weekend)).toBeNull(); // samedi, 7 h
    expect(currentPeriod(new Date(2026, 10, 7, 11, 30), weekend)).toBe('morning');
    expect(currentPeriod(new Date(2026, 10, 8, 18, 0), weekend)).toBe('evening'); // dimanche : heures habituelles
    expect(currentPeriod(new Date(2026, 10, 6, 7, 0), weekend)).toBe('morning'); // vendredi
  });

  it('étapes prévues selon le jour', () => {
    const steps = [
      { label: 'Dents', days: null },
      { label: 'Devoirs', days: [1, 2, 4] },
      { label: 'Piscine', days: [3] },
    ];
    expect(stepsOn(steps, new Date(2026, 10, 2)).map((s) => s.label)).toEqual(['Dents', 'Devoirs']); // lundi
    expect(stepsOn(steps, new Date(2026, 10, 4)).map((s) => s.label)).toEqual(['Dents', 'Piscine']); // mercredi
  });

  it('coche et décoche par jour ; relu depuis le fichier', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'homehub-routines-')), 'routines.json');
    const store = createRoutineStore({ path, clock: fixedClock });
    const pyjama = stepKey('lea', 'evening', 'Pyjama');
    await store.setDone('2026-11-02', pyjama, true, by);
    await store.setDone('2026-11-02', stepKey('lea', 'evening', 'Dents'), true, by);
    await store.setDone('2026-11-02', stepKey('lea', 'evening', 'Dents'), false, by);
    const reread = createRoutineStore({ path, clock: fixedClock });
    expect(await reread.doneOn('2026-11-02')).toEqual(new Set([pyjama]));
    expect(await reread.doneOn('2026-11-01')).toEqual(new Set());
  });

  it("jours de suite : aujourd'hui compte s'il est complet, sinon la série d'hier tient", async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'homehub-routines-')), 'routines.json');
    const store = createRoutineStore({ path, clock: fixedClock });
    const keys = [stepKey('lea', 'evening', 'Pyjama'), stepKey('lea', 'evening', 'Dents')];
    for (const day of ['2026-10-30', '2026-10-31', '2026-11-01']) for (const key of keys) await store.setDone(day, key, true, by);
    await store.setDone('2026-10-29', keys[0], true, by); // incomplet : la série commence le 30

    expect(await store.streak(() => keys, '2026-11-02')).toBe(3);
    await store.setDone('2026-11-02', keys[0], true, by);
    expect(await store.streak(() => keys, '2026-11-02')).toBe(3);
    await store.setDone('2026-11-02', keys[1], true, by);
    expect(await store.streak(() => keys, '2026-11-02')).toBe(4);
    expect(await store.streak(() => keys, '2026-11-04')).toBe(0); // le 3 manque
    expect(await store.streak(() => [], '2026-11-02')).toBe(0);
  });

  it("jours de suite : un jour sans étape prévue ne compte pas et ne casse pas la série", async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'homehub-routines-')), 'routines.json');
    const store = createRoutineStore({ path, clock: fixedClock });
    const devoirs = stepKey('lea', 'evening', 'Devoirs');
    // Devoirs le lundi et le jeudi seulement : jeudi 29 et lundi 2 faits, rien de prévu entre.
    const keysOn = (date: Date) => ([1, 4].includes(date.getDay()) ? [devoirs] : []);
    await store.setDone('2026-10-29', devoirs, true, by);
    expect(await store.streak(keysOn, '2026-11-02')).toBe(1);
    await store.setDone('2026-11-02', devoirs, true, by);
    expect(await store.streak(keysOn, '2026-11-02')).toBe(2);
  });
});
