import { describe, expect, it } from 'vitest';
import type { Weather, WeatherHour } from '../../../shared/types.ts';
import {
  dayExtra,
  firstRainSpell,
  formatMm,
  formatTemperature,
  hourlyPoints,
  rainLine,
  weatherIcon,
  weatherIconColor,
  weatherLabel,
  weatherOutlook,
  windDirection,
} from './weather.ts';

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

/** Heures à partir de 18:00, avec la pluie donnée heure par heure. */
const hoursFrom18 = (rain: number[]): WeatherHour[] =>
  rain.map((mm, i) => ({ time: at(18 + i).toISOString(), temperatureC: 10 - i / 2, precipitationMm: mm, weatherCode: 3, isDay: false }));

describe('page météo', () => {
  it('un point toutes les 3 h, avec la pluie de la tranche qui suit', () => {
    const points = hourlyPoints(hoursFrom18([0, 0.2, 0.3, 1, 0, 0, 0]));
    expect(points.map((p) => p.time.getHours())).toEqual([18, 21, 0]);
    expect(points.map((p) => p.rainMm)).toEqual([0.5, 1, 0]);
  });

  it('premier épisode de pluie', () => {
    const spell = firstRainSpell(hoursFrom18([0, 0, 0.4, 1.2, 0.05, 2]))!;
    expect(spell.start.getHours()).toBe(20);
    expect(spell.end.getHours()).toBe(22);
    expect(spell.totalMm).toBeCloseTo(1.6);
    expect(firstRainSpell(hoursFrom18([0, 0.05]))).toBeNull();
  });

  it('ligne de pluie', () => {
    const spell = firstRainSpell(hoursFrom18([0, 0, 1]));
    expect(rainLine(spell, at(18, 30))).toBe('Pluie vers 20 h');
    expect(rainLine(spell, at(20, 10))).toBe('Pluie en ce moment');
    expect(rainLine(null, at(18))).toBeNull();
  });

  it('vent, cumuls et compléments du jour', () => {
    expect(windDirection(0)).toBe('N');
    expect(windDirection(230)).toBe('SO');
    expect(windDirection(350)).toBe('N');
    expect(formatMm(2.64)).toBe('2,6 mm');
    expect(dayExtra(2.6, 19.6)).toBe('2,6 mm · vent 20 km/h');
    expect(dayExtra(0, null)).toBe('Sec');
    expect(dayExtra(null, null)).toBe('');
  });
});
