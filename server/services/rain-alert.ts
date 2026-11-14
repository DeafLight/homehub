// Alerte pluie sur la télé (appli HomeHub TV, fonction 14) : le matin, dans la plage réglée (`rainAlert` du YAML), les
// jours d'école (jours choisis, ni vacances scolaires ni jours fériés, comme le trajet du bus), si la météo déjà chargée
// prévoit de la pluie dans les heures qui viennent, chaque télé appairée reçoit une fois par matin le bandeau « Pluie
// vers 8 h : prenez un parapluie ». Une télé éteinte pendant toute la plage ne reçoit rien (pas de rattrapage après).
import { randomUUID } from 'node:crypto';
import { localDay, localTime } from '../../shared/dates.ts';
import { isNoSchoolDay, type SchoolHoliday } from '../../shared/school-holidays.ts';
import type { ScreenRainEvent } from '../../shared/screen.ts';
import type { WeatherHour } from '../../shared/types.ts';
import { type AppConfig, WEEK_DAYS } from '../config.ts';
import type { Logger } from '../config-store.ts';
import type { Clock } from '../sources/types.ts';
import type { ScreenHub } from './screens.ts';

export type RainAlertRules = AppConfig['rainAlert'];

/** Vérification de la plage et de la météo : toutes les 30 s (la météo est en cache, rien n'est rechargé pour autant). */
export const RAIN_TICK_MS = 30_000;
/** Attente du compte rendu de la télé : un bandeau ne télécharge rien. */
const REPORT_MS = 5_000;

const HOUR_MS = 3_600_000;

/** « 8 h », « 8 h 30 », heure locale. */
export const spokenHour = (date: Date) => {
  const minutes = date.getMinutes();
  return `${date.getHours()} h${minutes ? ` ${String(minutes).padStart(2, '0')}` : ''}`;
};

/** Vrai si `now` est dans la plage de l'alerte : jour choisi, jour d'école (`holidays` null : vacances inconnues). */
export function inRainWindow(rules: RainAlertRules, now: Date, holidays: readonly SchoolHoliday[] | null): boolean {
  if (!rules.enabled) return false;
  if (!rules.days.includes(WEEK_DAYS[now.getDay()])) return false;
  if (isNoSchoolDay(holidays ?? [], localDay(now))) return false;
  const time = localTime(now);
  return time >= rules.from && time < rules.to;
}

/**
 * Le bandeau à montrer d'après les heures de la prévision : la première heure pas encore finie, commencée avant
 * `rules.hours` heures, avec au moins `rules.thresholdMm` mm ; null s'il ne pleut pas assez.
 */
export function rainNotice(hours: readonly WeatherHour[], now: Date, rules: Pick<RainAlertRules, 'hours' | 'thresholdMm'>): { title: string; subtitle: string } | null {
  const t = now.getTime();
  const rain = hours.find((h) => {
    const start = Date.parse(h.time);
    return start + HOUR_MS > t && start < t + rules.hours * HOUR_MS && h.precipitationMm >= rules.thresholdMm;
  });
  if (!rain) return null;
  const start = new Date(rain.time);
  return {
    title: start.getTime() <= t ? 'Il pleut' : `Pluie vers ${spokenHour(start)}`,
    subtitle: 'Prenez un parapluie',
  };
}

export type RainAlertDeps = {
  rules(): RainAlertRules;
  /** Heures de la prévision (null : pas de météo configurée, ou indisponible). */
  hours(): Promise<WeatherHour[] | null>;
  /** Vacances scolaires connues (null : non configurées). */
  holidays(): Promise<SchoolHoliday[] | null>;
  /** Identifiants des télés appairées. */
  screens(): Promise<string[]>;
  hub: Pick<ScreenHub, 'online' | 'send'>;
  clock: Clock;
  logger: Logger;
};

export type RainAlert = ReturnType<typeof createRainAlert>;

export function createRainAlert({ rules, hours, holidays, screens, hub, clock, logger }: RainAlertDeps) {
  /** Dernier matin (AAAA-MM-JJ) où chaque télé a reçu l'alerte. */
  const alerted = new Map<string, string>();
  let running = false;

  /** Une vérification ; rend les télés qui ont reçu le bandeau (pour les tests). */
  async function tick(): Promise<string[]> {
    if (running) return [];
    running = true;
    try {
      const now = clock();
      const today = localDay(now);
      const r = rules();
      if (!r.enabled) return [];
      const waiting = (await screens()).filter((id) => alerted.get(id) !== today && hub.online(id));
      if (!waiting.length || !inRainWindow(r, now, await holidays())) return [];
      const forecast = await hours();
      const notice = forecast && rainNotice(forecast, now, r);
      if (!notice) return [];
      const sent: string[] = [];
      await Promise.all(
        waiting.map(async (id) => {
          const event: ScreenRainEvent = { kind: 'rain', id: randomUUID(), ...notice, seconds: r.seconds };
          // Une seule fois par matin, même si la télé ne répond pas (appli trop ancienne qui ignore l'alerte).
          alerted.set(id, today);
          sent.push(id);
          const report = await hub.send(id, event, REPORT_MS).catch((err: unknown) => ({ ok: false, reason: (err as Error).message }) as const);
          if (!report.ok) logger.error(`Alerte pluie sur la télé ${id} : ${report.reason}`);
        }),
      );
      return sent;
    } catch (err) {
      logger.error(`Alerte pluie : ${(err as Error).message}`);
      return [];
    } finally {
      running = false;
    }
  }

  return {
    tick,
    /** Lance les vérifications régulières ; rend de quoi les arrêter. */
    start(everyMs = RAIN_TICK_MS) {
      const timer = setInterval(() => void tick(), everyMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
