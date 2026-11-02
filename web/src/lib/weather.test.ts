import { describe, expect, it } from 'vitest';
import type { Weather } from '../../../shared/types.ts';
import { formatTemperature, weatherIcon, weatherIconColor, weatherLabel, weatherOutlook } from './weather.ts';

const at = (hour: number, minute = 0) => new Date(2026, 10, 2, hour, minute);

const weather: Weather = {
  location: 'Test',
  temperatureC: 9.6,
  weatherCode: 2,
  isDay: true,
  today: { minC: 3.7, maxC: 13.3 },
  tomorrow: { minC: 4.7, maxC: 10.6, weatherCode: 61 },
  rainStartsAt: null,
};

describe('codes météo', () => {
  it('libellés et icônes', () => {
    expect(weatherLabel(63)).toBe('Pluie');
    expect(weatherLabel(1234)).toBe('Temps incertain');
    expect(weatherIcon(0, true)).toBe('sun');
    expect(weatherIcon(0, false)).toBe('moon');
    expect(weatherIcon(2, false)).toBe('partlyNight');
    expect(weatherIcon(3, true)).toBe('cloud');
    expect(weatherIcon(81, true)).toBe('rain');
    expect(weatherIcon(96, true)).toBe('storm');
  });

  it('le soleil seul est en couleur', () => {
    expect(weatherIconColor(0, true)).toBe('var(--sun)');
    expect(weatherIconColor(0, false)).toBe('var(--fg-muted)');
    expect(weatherIconColor(63, true)).toBe('var(--fg-muted)');
  });

  it('arrondit les températures', () => {
    expect(formatTemperature(9.6)).toBe('10°');
    expect(formatTemperature(-0.4)).toBe('0°');
  });
});

describe('weatherOutlook', () => {
  it('en journée : min, max et heure de la pluie', () => {
    const rainy = { ...weather, rainStartsAt: at(21).toISOString() };
    expect(weatherOutlook(rainy, at(10))).toBe('Min 4° · Max 13° · pluie vers 21:00');
  });

  it('pluie déjà commencée', () => {
    expect(weatherOutlook({ ...weather, rainStartsAt: at(9).toISOString() }, at(9, 30))).toContain('pluie en ce moment');
  });

  it('en soirée : le lendemain', () => {
    expect(weatherOutlook(weather, at(18))).toBe('Demain : pluie faible, 5° à 11°');
  });
});
