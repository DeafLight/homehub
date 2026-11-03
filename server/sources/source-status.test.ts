import { describe, expect, it } from 'vitest';
import { NOW } from '../testing.ts';
import { createSourceStatus } from './source-status.ts';

describe('état des sources', () => {
  it('garde le dernier résultat de chaque source et le début d’une série d’échecs', () => {
    let now = NOW;
    const status = createSourceStatus(() => now);
    status.record('Open-Meteo');
    status.record('Agenda CAL_B', new Error('HTTP 404'));
    now = new Date(NOW.getTime() + 600_000);
    status.record('Agenda CAL_B', new Error('HTTP 410'));

    expect(status.list()).toEqual([
      { name: 'Agenda CAL_B', ok: false, at: now.toISOString(), error: 'HTTP 410', failingSince: NOW.toISOString() },
      { name: 'Open-Meteo', ok: true, at: NOW.toISOString() },
    ]);

    status.record('Agenda CAL_B');
    expect(status.list().every((s) => s.ok)).toBe(true);
  });
});
