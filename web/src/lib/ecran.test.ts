// Tests de l'écran de veille de la télé (page /ecran) : adresse reconnue, jeton lu puis retiré de l'adresse, lecture
// avec le jeton (télé retirée, serveur injoignable), rendez-vous rangés par jour, heures, menu du soir, jours de
// prévision, petit déplacement de l'écran, ligne de météo.
import { describe, expect, it, vi } from 'vitest';
import type { EcranData, EcranEvent } from '../../../shared/ecran.ts';
import { drift, ecranDays, ecranTime, ecranTitle, forecastDay, isEcranPath, loadEcran, showDinner, takeScreenToken, todayLine } from './ecran.ts';

const NOW = new Date(2026, 10, 15, 18, 0);
const at = (days: number, hours: number, minutes = 0) => new Date(2026, 10, 15 + days, hours, minutes).toISOString();
const ev = (title: string, start: string, more: Partial<EcranEvent> = {}): EcranEvent => ({ id: title, title, start, who: null, ...more });

describe('écran de veille : adresse et jeton', () => {
  it('reconnaît /ecran, avec ou sans barre finale', () => {
    expect(isEcranPath('/ecran')).toBe(true);
    expect(isEcranPath('/ecran/')).toBe(true);
    expect(isEcranPath('/ecrans')).toBe(false);
    expect(isEcranPath('/')).toBe(false);
  });

  it('lit #token=… et le retire de l’adresse ; sans jeton, adresse intacte', () => {
    const replaceState = vi.fn();
    const win = { location: { pathname: '/ecran', search: '', hash: '#token=abc' }, history: { replaceState } } as unknown as Window;
    expect(takeScreenToken(win)).toBe('abc');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/ecran');
    const bare = { location: { pathname: '/ecran', search: '', hash: '' }, history: { replaceState: vi.fn() } } as unknown as Window;
    expect(takeScreenToken(bare)).toBeNull();
    expect(bare.history.replaceState).not.toHaveBeenCalled();
  });

  it('lecture avec le jeton de la télé ; 401 : télé inconnue ; erreur réseau ou 500 : injoignable', async () => {
    const data = { weather: null, days: [], agenda: [], dinner: [], holiday: null } satisfies EcranData;
    const ok = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
    expect(await loadEcran('jeton', ok as unknown as typeof fetch)).toEqual({ data });
    expect(ok).toHaveBeenCalledWith('/api/screen/ecran', expect.objectContaining({ headers: { Authorization: 'Bearer jeton' } }));
    expect(await loadEcran('x', (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch)).toEqual({ error: 'unknown' });
    expect(await loadEcran('x', (async () => new Response('{}', { status: 502 })) as unknown as typeof fetch)).toEqual({ error: 'unreachable' });
    expect(await loadEcran('x', (async () => Promise.reject(new Error('réseau'))) as unknown as typeof fetch)).toEqual({ error: 'unreachable' });
  });
});

describe('écran de veille : mise en forme', () => {
  it('rendez-vous rangés en aujourd’hui et demain ; un jour vide disparaît', () => {
    const days = ecranDays([ev('Week-end', at(-1, 0), { allDay: true, end: at(1, 0) }), ev('Cinéma', at(0, 20)), ev('Judo', at(1, 9))], NOW);
    expect(days.map((d) => [d.label, d.events.map((e) => e.title)])).toEqual([
      ['Aujourd’hui', ['Week-end', 'Cinéma']],
      ['Demain', ['Judo']],
    ]);
    expect(ecranDays([ev('Judo', at(1, 9))], NOW).map((d) => d.label)).toEqual(['Demain']);
  });

  it('heure, journée entière, en cours ; prénom du membre devant le titre', () => {
    expect(ecranTime(ev('a', at(0, 20, 30)), NOW)).toBe('20:30');
    expect(ecranTime(ev('b', at(0, 0), { allDay: true }), NOW)).toBe('Journée');
    expect(ecranTime(ev('c', at(0, 17, 30), { end: at(0, 18, 30) }), NOW)).toBe('Jusqu’à 18:30');
    expect(ecranTime(ev('d', at(0, 17), { end: at(2, 10) }), NOW)).toBe('En cours');
    expect(ecranTitle(ev('Piscine', at(0, 19), { who: 'Léa' }))).toBe('Léa · Piscine');
    expect(ecranTitle(ev('Cinéma', at(0, 19)))).toBe('Cinéma');
  });

  it('menu du soir jusqu’à 21 h, et seulement s’il y en a un', () => {
    expect(showDinner(['Soupe'], NOW)).toBe(true);
    expect(showDinner(['Soupe'], new Date(2026, 10, 15, 21, 5))).toBe(false);
    expect(showDinner([], NOW)).toBe(false);
  });

  it('jours de prévision : « Demain », puis le jour de la semaine', () => {
    expect(forecastDay(new Date(2026, 10, 16), NOW)).toBe('Demain');
    expect(forecastDay(new Date(2026, 10, 17), NOW)).toBe('Mar.');
  });

  it('déplacement de l’écran entre -2 et 2 %', () => {
    expect(drift(() => 0)).toEqual({ x: -2, y: -2 });
    expect(drift(() => 0.5)).toEqual({ x: 0, y: 0 });
    const { x, y } = drift();
    expect(Math.abs(x)).toBeLessThanOrEqual(2);
    expect(Math.abs(y)).toBeLessThanOrEqual(2);
  });

  it('météo du jour : min, max, pluie à venir ou en cours', () => {
    const weather = { location: 'Angers', temperatureC: 9, weatherCode: 3, isDay: true, today: { minC: 4.4, maxC: 12.6 }, tomorrow: null, rainStartsAt: null };
    expect(todayLine(weather, NOW)).toBe('Min 4° · Max 13°');
    expect(todayLine({ ...weather, rainStartsAt: at(0, 21) }, NOW)).toBe('Min 4° · Max 13° · pluie vers 21:00');
    expect(todayLine({ ...weather, rainStartsAt: at(0, 17) }, NOW)).toBe('Min 4° · Max 13° · pluie en ce moment');
  });
});
