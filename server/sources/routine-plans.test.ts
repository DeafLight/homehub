import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.ts';
import { createConfigStore } from '../config-store.ts';
import { fixedClock } from '../testing.ts';
import { createRoutinePlanStore, DEFAULT_ROUTINE_WINDOWS, routineSettingsInput } from './routine-plans.ts';

const config = createConfigStore(
  parseConfig({
    members: [
      { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
      { id: 'lea', name: 'Léa', color: '#4caf7d' },
    ],
  }),
);
const by = { ownerId: 'alex', via: 'tablet' as const };
const windows = { morning: { from: '06:30', to: '08:30' }, evening: { from: '19:00', to: '21:00' } };
const tempPath = () => join(mkdtempSync(join(tmpdir(), 'homehub-plans-')), 'p.json');

describe('réglages des routines', () => {
  it("avant tout enregistrement : aucune étape, heures par défaut", async () => {
    const store = createRoutinePlanStore({ path: tempPath(), clock: fixedClock, config });
    await store.load();
    expect(store.current()).toEqual({
      windows: DEFAULT_ROUTINE_WINDOWS,
      members: { alex: { morning: [], evening: [] }, lea: { morning: [], evening: [] } },
    });
  });

  it('enregistrés, puis relus ; les membres absents de l’envoi gardent leurs étapes', async () => {
    const path = tempPath();
    const store = createRoutinePlanStore({ path, clock: fixedClock, config });
    await store.load();
    await store.save(routineSettingsInput.parse({ members: { lea: { morning: [{ id: 'l1', label: 'Dents', days: [3] }], evening: [] } }, windows }), by);
    const input = routineSettingsInput.parse({
      members: { alex: { morning: [{ id: 'a1', label: ' Café ', days: [0, 1, 2, 3, 4, 5, 6] }], evening: [] } },
      windows,
    });
    const saved = await store.save(input, by);
    expect(saved.windows).toEqual(windows);
    expect(saved.members.alex.morning).toEqual([{ id: 'a1', label: 'Café', days: null }]); // tous les jours : null
    expect(saved.members.lea.morning).toEqual([{ id: 'l1', label: 'Dents', days: [3] }]);

    const reread = createRoutinePlanStore({ path, clock: fixedClock, config });
    await reread.load();
    expect(reread.current()).toEqual(saved);
  });

  it('refuse les étapes en double, sans nom ou sans jour, et les heures à l’envers', () => {
    const plan = (morning: unknown[]) => ({ members: { lea: { morning, evening: [] } }, windows });
    expect(routineSettingsInput.safeParse(plan([{ id: 'a', label: 'Dents', days: null }, { id: 'b', label: 'dents', days: null }])).success).toBe(false);
    expect(routineSettingsInput.safeParse(plan([{ id: 'a', label: '  ', days: null }])).success).toBe(false);
    expect(routineSettingsInput.safeParse(plan([{ id: 'a', label: 'Dents', days: [] }])).success).toBe(false);
    expect(routineSettingsInput.safeParse({ ...plan([]), windows: { ...windows, morning: { from: '09:00', to: '08:00' } } }).success).toBe(false);
    expect(routineSettingsInput.safeParse(plan([{ id: 'a', label: 'Dents', days: [5, 1, 1] }])).data?.members.lea.morning[0].days).toEqual([1, 5]);
  });
});
