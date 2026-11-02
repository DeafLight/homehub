// Présentation de la météo : le serveur transmet des données (codes WMO, températures), le front choisit les mots.
import type { Weather } from '../../../shared/types.ts';
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
