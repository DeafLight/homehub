// Tests du réglage des vacances scolaires (page « Vacances scolaires ») : le YAML tant que rien n'est enregistré,
// puis le choix de la page (académie, zone ou rien), relu au redémarrage.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.ts';
import { createConfigStore } from '../config-store.ts';
import { fixedClock } from '../testing.ts';
import { createHolidaySettingsStore, holidaySettingsInput } from './holiday-settings.ts';

const members = [{ id: 'alex', name: 'Alex', color: '#5b8def', parent: true }];
const by = { ownerId: 'alex', via: 'tablet' as const };
const tempPath = () => join(mkdtempSync(join(tmpdir(), 'homehub-holiday-settings-')), 'h.json');

describe('réglage des vacances scolaires', () => {
  it('rien d’enregistré : la section holidays du YAML (nom officiel), ou rien', async () => {
    const config = createConfigStore(parseConfig({ members, holidays: { academie: 'orleans tours' } }));
    const store = createHolidaySettingsStore({ path: tempPath(), clock: fixedClock, config });
    await store.load();
    expect(store.current()).toMatchObject({ choice: { academie: 'Orléans-Tours' }, saved: false });
    expect(store.settings()).toEqual({ academie: 'Orléans-Tours' });
    expect(store.current().academies).toContainEqual({ name: 'Nantes', zone: 'Zone B' });
    config.set(parseConfig({ members }));
    expect(store.current().choice).toBeNull();
    expect(store.settings()).toBeUndefined();
  });

  it('enregistré : prend le pas sur le YAML, relu au redémarrage ; null désactive', async () => {
    const config = createConfigStore(parseConfig({ members, holidays: { academie: 'Nantes' } }));
    const path = tempPath();
    const store = createHolidaySettingsStore({ path, clock: fixedClock, config });
    await store.load();
    expect(await store.save(holidaySettingsInput.parse({ choice: { zone: 'C' } }), by)).toMatchObject({ choice: { zone: 'C' }, saved: true });
    expect(store.settings()).toEqual({ zone: 'C' });

    const reread = createHolidaySettingsStore({ path, clock: fixedClock, config });
    await reread.load();
    expect(reread.settings()).toEqual({ zone: 'C' });

    await reread.save({ choice: null }, by);
    expect(reread.current()).toMatchObject({ choice: null, saved: true }); // désactivées malgré le YAML
    expect(reread.settings()).toBeUndefined();
  });

  it('validation : académie connue (forme officielle), zone A/B/C, rien d’autre', () => {
    expect(holidaySettingsInput.parse({ choice: { academie: ' reunion ' } })).toEqual({ choice: { academie: 'Réunion' } });
    expect(holidaySettingsInput.parse({ choice: { academie: 'Caen' } })).toEqual({ choice: { academie: 'Normandie' } });
    expect(holidaySettingsInput.safeParse({ choice: { academie: 'Atlantide' } }).success).toBe(false);
    expect(holidaySettingsInput.safeParse({ choice: { zone: 'D' } }).success).toBe(false);
    expect(holidaySettingsInput.safeParse({ choice: { academie: 'Nantes', zone: 'B' } }).success).toBe(false);
    expect(holidaySettingsInput.safeParse({}).success).toBe(false);
  });
});
