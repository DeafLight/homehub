// Tests de l'alerte pluie de la télé : plage du matin et jours d'école, seuil et horizon, texte du bandeau, une fois
// par matin et par télé, télé absente, météo indisponible, réglages par défaut.
import { describe, expect, it } from 'vitest';
import type { ScreenEventBody, ScreenReport } from '../../shared/screen.ts';
import type { WeatherHour } from '../../shared/types.ts';
import { parseConfig } from '../config.ts';
import { silentLogger, testConfig } from '../testing.ts';
import { createRainAlert, inRainWindow, rainNotice, type RainAlertRules, spokenHour } from './rain-alert.ts';

/** Jeudi 5 novembre 2026, 7 h 35 (jour d'école). */
const MORNING = new Date(2026, 10, 5, 7, 35);
const RULES: RainAlertRules = testConfig.rainAlert;

/** Prévision horaire à partir de 7 h ce matin-là : `mm[i]` pour l'heure 7 + i. */
const forecast = (...mm: number[]): WeatherHour[] =>
  mm.map((precipitationMm, i) => ({
    time: new Date(2026, 10, 5, 7 + i).toISOString(),
    temperatureC: 9,
    precipitationMm,
    weatherCode: precipitationMm ? 61 : 3,
    isDay: true,
  }));

describe('réglages', () => {
  it('actifs par défaut, de 7 h à 8 h 30 en semaine, 0,5 mm dans les 3 h, 60 s', () => {
    expect(RULES).toEqual({ enabled: true, from: '07:00', to: '08:30', days: ['lun', 'mar', 'mer', 'jeu', 'ven'], hours: 3, thresholdMm: 0.5, seconds: 60 });
  });

  it('refuse une plage à l’envers', () => {
    expect(() => parseConfig({ members: [{ id: 'alex', name: 'Alex', color: '#5b8def' }], rainAlert: { from: '09:00', to: '08:00' } })).toThrow(/rainAlert/);
  });
});

describe('plage du matin', () => {
  it('jour d’école, dans la plage', () => {
    expect(inRainWindow(RULES, MORNING, [])).toBe(true);
  });

  it('avant, à la fin et après la plage', () => {
    expect(inRainWindow(RULES, new Date(2026, 10, 5, 6, 59), [])).toBe(false);
    expect(inRainWindow(RULES, new Date(2026, 10, 5, 8, 30), [])).toBe(false);
    expect(inRainWindow(RULES, new Date(2026, 10, 5, 12, 0), [])).toBe(false);
  });

  it('ni le week-end, ni en vacances, ni un jour férié', () => {
    expect(inRainWindow(RULES, new Date(2026, 10, 7, 7, 35), [])).toBe(false);
    expect(inRainWindow(RULES, MORNING, [{ name: 'Toussaint', start: '2026-11-02', end: '2026-11-09' }])).toBe(false);
    expect(inRainWindow(RULES, new Date(2026, 10, 11, 7, 35), [])).toBe(false);
  });

  it('vacances inconnues : jours choisis seulement ; alerte arrêtée : jamais', () => {
    expect(inRainWindow(RULES, MORNING, null)).toBe(true);
    expect(inRainWindow({ ...RULES, enabled: false }, MORNING, [])).toBe(false);
    expect(inRainWindow({ ...RULES, days: ['sam'] }, new Date(2026, 10, 7, 7, 35), [])).toBe(true);
  });
});

describe('bandeau', () => {
  it('première heure assez pluvieuse dans l’horizon', () => {
    expect(rainNotice(forecast(0, 0.2, 1.5, 3), MORNING, RULES)).toEqual({ title: 'Pluie vers 9 h', subtitle: 'Prenez un parapluie' });
  });

  it('il pleut déjà', () => {
    expect(rainNotice(forecast(0.8, 0), MORNING, RULES)?.title).toBe('Il pleut');
  });

  it('rien sous le seuil ni au-delà de l’horizon', () => {
    expect(rainNotice(forecast(0.3, 0.4, 0.1), MORNING, RULES)).toBeNull();
    expect(rainNotice(forecast(0, 0, 0, 0, 5), MORNING, RULES)).toBeNull();
    expect(rainNotice(forecast(0, 0, 0, 0, 5), MORNING, { hours: 4, thresholdMm: 0.5 })?.title).toBe('Pluie vers 11 h');
  });

  it('heure dite à la française', () => {
    expect(spokenHour(new Date(2026, 10, 5, 8, 0))).toBe('8 h');
    expect(spokenHour(new Date(2026, 10, 5, 8, 30))).toBe('8 h 30');
    expect(spokenHour(new Date(2026, 10, 5, 8, 5))).toBe('8 h 05');
  });
});

describe('envoi aux télés', () => {
  const setup = (over: Partial<{ now: Date; hours: WeatherHour[] | null; online: string[]; rules: RainAlertRules; report: ScreenReport }> = {}) => {
    const state = { now: MORNING, hours: forecast(0, 1.2) as WeatherHour[] | null, online: ['salon', 'chambre'], rules: RULES, report: { ok: true } as ScreenReport, ...over };
    const sent: { id: string; event: ScreenEventBody }[] = [];
    const logger = silentLogger();
    const alert = createRainAlert({
      rules: () => state.rules,
      hours: async () => state.hours,
      holidays: async () => [],
      screens: async () => ['salon', 'chambre'],
      hub: {
        online: (id) => state.online.includes(id),
        send: async (id, event) => {
          sent.push({ id, event });
          return state.report;
        },
      },
      clock: () => state.now,
      logger,
    });
    return { state, sent, alert, logger };
  };

  it('bandeau sur chaque télé en ligne, une fois par matin', async () => {
    const { sent, alert } = setup();
    expect((await alert.tick()).sort()).toEqual(['chambre', 'salon']);
    expect(sent[0].event).toMatchObject({ kind: 'rain', title: 'Pluie vers 8 h', subtitle: 'Prenez un parapluie', seconds: 60 });
    expect(await alert.tick()).toEqual([]);
    expect(sent).toHaveLength(2);
  });

  it('une télé allumée plus tard dans la plage la reçoit à son tour', async () => {
    const { state, alert } = setup({ online: ['salon'] });
    expect(await alert.tick()).toEqual(['salon']);
    state.online = ['salon', 'chambre'];
    state.now = new Date(2026, 10, 5, 8, 10);
    expect(await alert.tick()).toEqual(['chambre']);
  });

  it('de nouveau le lendemain matin', async () => {
    const { state, alert } = setup();
    await alert.tick();
    state.now = new Date(2026, 10, 6, 7, 35);
    state.hours = state.hours!.map((h) => ({ ...h, time: new Date(Date.parse(h.time) + 86_400_000).toISOString() }));
    expect(await alert.tick()).toHaveLength(2);
  });

  it('rien sans pluie, sans météo, hors plage ou alerte arrêtée', async () => {
    expect(await setup({ hours: forecast(0, 0, 0) }).alert.tick()).toEqual([]);
    expect(await setup({ hours: null }).alert.tick()).toEqual([]);
    expect(await setup({ now: new Date(2026, 10, 5, 9, 0) }).alert.tick()).toEqual([]);
    expect(await setup({ rules: { ...RULES, enabled: false } }).alert.tick()).toEqual([]);
  });

  it('la pluie annoncée plus tard dans la plage déclenche l’alerte à ce moment-là', async () => {
    const { state, alert } = setup({ hours: forecast(0, 0, 0, 0) });
    expect(await alert.tick()).toEqual([]);
    state.hours = forecast(0, 0, 0, 2);
    state.now = new Date(2026, 10, 5, 8, 15);
    expect(await alert.tick()).toHaveLength(2);
  });

  it('télé qui ne répond pas : notée, et pas relancée ce matin', async () => {
    const { sent, alert, logger } = setup({ online: ['salon'], report: { ok: false, reason: 'La télé n’a pas répondu' } });
    await alert.tick();
    await alert.tick();
    expect(sent).toHaveLength(1);
    expect(logger.errors[0]).toMatch(/salon.*pas répondu/);
  });
});
