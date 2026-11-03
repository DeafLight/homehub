// Présentation de la météo : le serveur transmet des données (codes WMO, températures), le front choisit les mots.
import type { Weather, WeatherHour } from '../../../shared/types.ts';
import type { IconName } from '../components/Icon.svelte';
import { formatTime } from './format.ts';

/** À partir de cette heure, la prévision du lendemain remplace celle du jour. */
const EVENING_HOUR = 17;

type Kind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

/** Codes météo WMO (https://open-meteo.com/en/docs, « WMO Weather interpretation codes »). */
const CODES: Record<number, [label: string, kind: Kind]> = {
  0: ['Ciel dégagé', 'clear'],
  1: ['Plutôt dégagé', 'partly'],
  2: ['Éclaircies', 'partly'],
  3: ['Couvert', 'cloudy'],
  45: ['Brouillard', 'fog'],
  48: ['Brouillard givrant', 'fog'],
  51: ['Bruine légère', 'rain'],
  53: ['Bruine', 'rain'],
  55: ['Bruine dense', 'rain'],
  56: ['Bruine verglaçante', 'rain'],
  57: ['Bruine verglaçante', 'rain'],
  61: ['Pluie faible', 'rain'],
  63: ['Pluie', 'rain'],
  65: ['Forte pluie', 'rain'],
  66: ['Pluie verglaçante', 'rain'],
  67: ['Pluie verglaçante', 'rain'],
  71: ['Neige faible', 'snow'],
  73: ['Neige', 'snow'],
  75: ['Forte neige', 'snow'],
  77: ['Grésil', 'snow'],
  80: ['Averses', 'rain'],
  81: ['Averses', 'rain'],
  82: ['Fortes averses', 'rain'],
  85: ['Averses de neige', 'snow'],
  86: ['Averses de neige', 'snow'],
  95: ['Orage', 'storm'],
  96: ['Orage et grêle', 'storm'],
  99: ['Orage et grêle', 'storm'],
};

const describe = (code: number): [string, Kind] => CODES[code] ?? ['Temps incertain', 'cloudy'];

export const weatherLabel = (code: number) => describe(code)[0];

export function weatherIcon(code: number, isDay: boolean): IconName {
  const kind = describe(code)[1];
  if (kind === 'clear') return isDay ? 'sun' : 'moon';
  if (kind === 'partly') return isDay ? 'partly' : 'partlyNight';
  return kind === 'cloudy' ? 'cloud' : kind;
}

/** Le soleil en couleur, le reste dans la teinte du texte secondaire. */
export const weatherIconColor = (code: number, isDay: boolean) =>
  isDay && ['clear', 'partly'].includes(describe(code)[1]) ? 'var(--sun)' : 'var(--fg-muted)';

export const formatTemperature = (celsius: number) => `${Math.round(celsius)}°`;

/** Ligne de prévision : « Min 4° · Max 13° · pluie vers 21:00 », ou le lendemain en soirée. */
export function weatherOutlook(weather: Weather, now: Date): string {
  const parts: string[] = [];
  if (now.getHours() >= EVENING_HOUR && weather.tomorrow) {
    const { minC, maxC, weatherCode } = weather.tomorrow;
    parts.push(`Demain : ${weatherLabel(weatherCode).toLowerCase()}, ${formatTemperature(minC)} à ${formatTemperature(maxC)}`);
  } else {
    parts.push(`Min ${formatTemperature(weather.today.minC)}`, `Max ${formatTemperature(weather.today.maxC)}`);
  }

  if (weather.rainStartsAt) {
    const start = new Date(weather.rainStartsAt);
    parts.push(start <= now ? 'pluie en ce moment' : `pluie vers ${formatTime(start)}`);
  }
  return parts.join(' · ');
}

/** Seuil en dessous duquel une heure est considérée comme sèche (mm). */
const RAIN_MM = 0.1;
const HOUR_MS = 3_600_000;

const mmFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** « 2,6 mm » */
export const formatMm = (mm: number) => `${mmFormat.format(mm)} mm`;

/** « 21 h » */
export const formatHour = (date: Date) => `${date.getHours()} h`;

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/** Point cardinal d'où vient le vent (0° = nord). */
export const windDirection = (fromDeg: number) => DIRECTIONS[Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8];

export function humidityLabel(pct: number): string {
  if (pct < 40) return 'Air sec';
  if (pct > 80) return 'Air humide';
  return 'Air normal';
}

export type ChartPoint = { time: Date; temperatureC: number; weatherCode: number; isDay: boolean; rainMm: number };

/** Un point toutes les `step` heures, avec la pluie cumulée jusqu'au point suivant (0 pour le dernier). */
export function hourlyPoints(hours: WeatherHour[], step = 3): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (let i = 0; i < hours.length; i += step) {
    const { time, temperatureC, weatherCode, isDay } = hours[i];
    const window = i + step < hours.length ? hours.slice(i, i + step) : [];
    const rainMm = window.reduce((sum, h) => sum + h.precipitationMm, 0);
    points.push({ time: new Date(time), temperatureC, weatherCode, isDay, rainMm });
  }
  return points;
}

export type RainSpell = { start: Date; end: Date; totalMm: number };

/** Premier épisode de pluie des heures fournies (heures pluvieuses consécutives), ou null. */
export function firstRainSpell(hours: WeatherHour[]): RainSpell | null {
  const first = hours.findIndex((h) => h.precipitationMm >= RAIN_MM);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < hours.length && hours[last + 1].precipitationMm >= RAIN_MM) last++;
  const spell = hours.slice(first, last + 1);
  return {
    start: new Date(spell[0].time),
    end: new Date(new Date(spell[spell.length - 1].time).getTime() + HOUR_MS),
    totalMm: spell.reduce((sum, h) => sum + h.precipitationMm, 0),
  };
}

/** « Pluie en ce moment », « Pluie vers 21 h », ou null s'il ne pleut pas dans les heures fournies. */
export function rainLine(spell: RainSpell | null, now: Date): string | null {
  if (!spell) return null;
  return spell.start <= now ? 'Pluie en ce moment' : `Pluie vers ${formatHour(spell.start)}`;
}

/** Complément d'une journée : « 2,6 mm · vent 20 km/h », « Sec ». */
export function dayExtra(precipitationMm: number | null, windMaxKmh: number | null): string {
  const parts: string[] = [];
  if (precipitationMm !== null) parts.push(precipitationMm >= RAIN_MM ? formatMm(precipitationMm) : 'Sec');
  if (windMaxKmh !== null) parts.push(`vent ${Math.round(windMaxKmh)} km/h`);
  return parts.join(' · ');
}
