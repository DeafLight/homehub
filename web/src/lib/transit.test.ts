import { describe, expect, it } from 'vitest';
import type { Commute, Departure } from '../../../shared/types.ts';
import { commuteState, departureRows, departureText } from './transit.ts';

const now = new Date(2026, 10, 2, 7, 30);
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
const dep = (line: string, destination: string, minutes: number, extra: Partial<Departure> = {}): Departure => ({
  line,
  destination,
  at: at(minutes),
  realtime: true,
  ...extra,
});

describe('passages', () => {
  it('regroupe par ligne et destination, deux passages, sans les supprimés ni les partis', () => {
    const rows = departureRows(
      [dep('3', 'Centre', -2), dep('3', 'Centre', 4), dep('A', 'Gare', 5), dep('3', 'Centre', 9, { cancelled: true }), dep('3', 'Centre', 17), dep('3', 'Centre', 30)],
      now,
    );
    expect(rows.map((r) => [r.line, r.destination, r.next.map((d) => departureText(d, now))])).toEqual([
      ['3', 'Centre', ['4 min', '17 min']],
      ['A', 'Gare', ['5 min']],
    ]);
    expect(departureText(dep('3', 'Centre', 0.5), now)).toBe('à l’arrêt');
    expect(departureText(dep('3', 'Centre', 75), now)).toBe('08:45');
  });
});

describe('trajet du matin', () => {
  const commute = (departures: Departure[]): Commute => ({ line: '3', stop: 'Mairie', label: 'Collège', walkMinutes: 4, departures, alerts: [] });

  it('dit quand partir, en comptant la marche', () => {
    const state = commuteState(commute([dep('3', 'Centre', 10), dep('3', 'Centre', 25)]), now);
    expect(state).toEqual({
      tone: 'go',
      leaveIn: 6,
      title: 'Pars dans 6 min pour le bus 3 de 07:40',
      detail: 'Mairie → Collège · 4 min à pied · suivant à 07:55',
    });
  });

  it('presse la dernière minute, puis passe au suivant ; trop tard s’il n’y en a plus', () => {
    expect(commuteState(commute([dep('3', 'Centre', 5), dep('3', 'Centre', 20)]), now)).toMatchObject({ tone: 'hurry', title: 'Pars maintenant pour le bus 3 de 07:35' });
    expect(commuteState(commute([dep('3', 'Centre', 3), dep('3', 'Centre', 20)]), now)).toMatchObject({ tone: 'go', leaveIn: 16 });
    expect(commuteState(commute([dep('3', 'Centre', 3)]), now)).toMatchObject({ tone: 'late', title: 'Trop tard pour le bus 3 de 07:33' });
    expect(commuteState(commute([]), now)).toMatchObject({ tone: 'none', title: 'Pas de bus 3 annoncé' });
    expect(commuteState({ ...commute([dep('A', 'Gare', 12)]), line: 'A' }, now).title).toBe('Pars dans 8 min pour le tram A de 07:42');
  });
});
