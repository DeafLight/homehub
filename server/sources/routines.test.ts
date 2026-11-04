import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../testing.ts';
import { createRoutineStore, currentPeriod, stepKey } from './routines.ts';

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

    expect(await store.streak(keys, '2026-11-02')).toBe(3);
    await store.setDone('2026-11-02', keys[0], true, by);
    expect(await store.streak(keys, '2026-11-02')).toBe(3);
    await store.setDone('2026-11-02', keys[1], true, by);
    expect(await store.streak(keys, '2026-11-02')).toBe(4);
    expect(await store.streak(keys, '2026-11-04')).toBe(0); // le 3 manque
    expect(await store.streak([], '2026-11-02')).toBe(0);
  });
});
