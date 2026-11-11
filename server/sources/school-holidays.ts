// Vacances scolaires : calendrier officiel du ministère de l'Éducation nationale (jeu de données ouvert
// « fr-en-calendrier-scolaire » sur data.education.gouv.fr, API Opendatasoft, sans clé), pour l'académie ou la zone
// réglée par la page « Vacances scolaires » (sinon homehub.yaml). Rechargé au plus une fois par jour ; le dernier
// calendrier reçu est gardé dans le dossier d'état (school-holidays.json) : une panne de l'API, même au redémarrage,
// laisse les vacances affichées. Aperçu d'un autre réglage (avant d'enregistrer) : en mémoire seulement.
import { z } from 'zod';
import { localDay } from '../../shared/dates.ts';
import { type SchoolHoliday, shiftDay, weekdayOf } from '../../shared/school-holidays.ts';
import type { HolidaysConfig } from '../config.ts';
import type { Logger } from '../config-store.ts';
import { createJsonFile } from './json-file.ts';
import { normalizeName } from './school.ts';
import type { SourceStatus } from './source-status.ts';
import type { Clock } from './types.ts';

export const HOLIDAYS_API_URL =
  'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/exports/json';
const REQUEST_TIMEOUT_MS = 15_000;
/** Le calendrier change très rarement : une fois par jour suffit. */
const REFRESH_MS = 24 * 3_600_000;
/** Après un échec, nouvel essai au plus tôt une heure après. */
const RETRY_MS = 3_600_000;
/** Périodes demandées : celles qui finissent au plus tôt 30 jours avant aujourd'hui. */
const PAST_DAYS = 30;
const STATUS_NAME = 'Vacances scolaires';
/** Réglages gardés en mémoire pour l'aperçu de la page (un par académie ou zone essayée). */
const MAX_PREVIEWS = 8;
/** Aperçu en échec : nouvel essai possible au bout de 5 minutes. */
const PREVIEW_RETRY_MS = 5 * 60_000;

/**
 * Académies du jeu de données (champ `location`) et leur zone (champ `zones`). Caen et Rouen ont fusionné en
 * Normandie (2020) ; leurs anciens noms restent acceptés.
 */
export const ACADEMIES: Record<string, string> = {
  ...Object.fromEntries(
    ['Besançon', 'Bordeaux', 'Clermont-Ferrand', 'Dijon', 'Grenoble', 'Limoges', 'Lyon', 'Poitiers'].map((a) => [a, 'Zone A']),
  ),
  ...Object.fromEntries(
    ['Aix-Marseille', 'Amiens', 'Lille', 'Nancy-Metz', 'Nantes', 'Nice', 'Normandie', 'Orléans-Tours', 'Reims', 'Rennes', 'Strasbourg'].map(
      (a) => [a, 'Zone B'],
    ),
  ),
  ...Object.fromEntries(['Créteil', 'Montpellier', 'Paris', 'Toulouse', 'Versailles'].map((a) => [a, 'Zone C'])),
  // Corse et outre-mer : calendriers propres, la zone porte le nom du territoire.
  ...Object.fromEntries(
    ['Corse', 'Guadeloupe', 'Guyane', 'Martinique', 'Mayotte', 'Nouvelle Calédonie', 'Polynésie', 'Réunion', 'Saint Pierre et Miquelon', 'Wallis et Futuna'].map(
      (a) => [a, a],
    ),
  ),
};
const ALIASES: Record<string, string> = { caen: 'Normandie', rouen: 'Normandie' };

/** Nom comparable : sans accents, majuscules, tirets ni espaces en trop (« orleans tours » = « Orléans-Tours »). */
const comparable = (s: string) => normalizeName(s).replace(/[-\s]+/g, ' ');

/** Nom officiel d'une académie écrite à la main ; undefined si inconnue. */
export function findAcademie(name: string): string | undefined {
  const key = comparable(name);
  return ALIASES[key] ?? Object.keys(ACADEMIES).find((a) => comparable(a) === key);
}

/** Filtre de la requête : l'académie (ses dates exactes) ou toute la zone (dates communes, dédoublonnées). */
export function holidaysFilter(config: HolidaysConfig): { field: 'location' | 'zones'; value: string; zone: string } {
  if (config.academie) {
    const academie = findAcademie(config.academie) ?? config.academie;
    return { field: 'location', value: academie, zone: ACADEMIES[academie] ?? academie };
  }
  const zone = `Zone ${config.zone}`;
  return { field: 'zones', value: zone, zone };
}

export function buildHolidaysUrl(config: HolidaysConfig, today: string): string {
  const { field, value } = holidaysFilter(config);
  const params = new URLSearchParams({
    where: `${field}="${value}" and end_date>="${shiftDay(today, -PAST_DAYS)}"`,
    order_by: 'start_date',
  });
  return `${HOLIDAYS_API_URL}?${params}`;
}

const recordSchema = z.object({
  description: z.string(),
  population: z.string().nullish(),
  start_date: z.string(),
  end_date: z.string().nullish(),
  annee_scolaire: z.string().nullish(),
});
export const holidaysResponseSchema = z.array(z.unknown());
type HolidayRecord = z.infer<typeof recordSchema>;

/**
 * Jour local d'une date du jeu de données. Les dates sont des minuits locaux exprimés en UTC (« 2026-12-18T23:00Z »
 * pour le 19 décembre à Paris) : douze heures plus tard, on est le bon jour en UTC, quel que soit le fuseau du
 * territoire (de -10 h en Polynésie à +11 h en Nouvelle-Calédonie) et celui du serveur.
 */
function dayOf(value: string): string | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time + 12 * 3_600_000).toISOString().slice(0, 10);
}

/** Lundi suivant si `day` tombe un week-end. */
const notWeekend = (day: string) => (weekdayOf(day) === 6 ? shiftDay(day, 2) : weekdayOf(day) === 0 ? shiftDay(day, 1) : day);

/** « Vacances d'Hiver » → « Vacances d’hiver » ; « Début des Vacances d'Été » → « Vacances d’été ». */
export function holidayName(description: string): string {
  return description
    .trim()
    .replace(/^Début des\s+/i, '')
    .replace(/'/g, '’')
    .replace(/\b(d’|de |du )(Hiver|Été|Printemps|Automne|Fin|Année)/gu, (_, prefix: string, word: string) => prefix + word.toLowerCase())
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Rang d'une population : les vacances de tous (« - ») puis celles des élèves ; un sous-territoire (« Saint-Martin »)
 * en dernier recours. Celles des enseignants (pré-rentrée plus tôt) ne concernent pas les enfants : écartées.
 */
function populationRank(population: string | null | undefined): number | null {
  const p = normalizeName(population ?? '-');
  if (p === '-' || p === '') return 0;
  if (p.startsWith('enseignant')) return null;
  if (p === 'eleves') return 1;
  if (p.startsWith('eleves')) return 2;
  return 3;
}

/**
 * Périodes de vacances lisibles, triées, une par vacances et par année scolaire : `start` premier jour sans école,
 * `end` jour de la reprise (jamais un week-end). Un pont d'un seul jour (début = fin) finit le lendemain ; un
 * « Début des vacances » n'a pas encore de reprise (null). Les lignes illisibles sont ignorées.
 */
export function parseHolidays(records: unknown[]): SchoolHoliday[] {
  const best = new Map<string, { rank: number; record: HolidayRecord }>();
  for (const raw of records) {
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success) continue;
    const record = parsed.data;
    const rank = populationRank(record.population);
    if (rank === null) continue;
    const key = `${record.annee_scolaire ?? ''}|${normalizeName(holidayName(record.description))}`;
    const kept = best.get(key);
    if (!kept || rank < kept.rank || (rank === kept.rank && record.start_date < kept.record.start_date)) best.set(key, { rank, record });
  }
  const holidays: SchoolHoliday[] = [];
  for (const { record } of best.values()) {
    const start = dayOf(record.start_date);
    if (!start) continue;
    const unknownEnd = /^Début des\s/i.test(record.description.trim());
    const endDay = record.end_date ? dayOf(record.end_date) : null;
    const end = unknownEnd || !endDay ? null : notWeekend(endDay > start ? endDay : shiftDay(start, 1));
    holidays.push({ name: holidayName(record.description), start, end });
  }
  return holidays.sort((a, b) => a.start.localeCompare(b.start));
}

export type SchoolHolidaySource = {
  /** Périodes connues pour la configuration en cours ; null si les vacances ne sont pas configurées ou jamais reçues. */
  list(): Promise<SchoolHoliday[] | null>;
  /** Zone du calendrier réglé, ou de `config` (« Zone B », « Corse »…) ; null si les vacances ne sont pas configurées. */
  zone(config?: HolidaysConfig): string | null;
  /**
   * Périodes d'un autre réglage, pour l'aperçu de la page « Vacances scolaires » avant d'enregistrer : gardées en
   * mémoire un jour (quelques réglages au plus), jamais dans le fichier d'état ; null si l'API ne répond pas.
   */
  preview(config: HolidaysConfig): Promise<SchoolHoliday[] | null>;
};

export type SchoolHolidaysDeps = {
  /** Lu à chaque appel : académie ou zone, absente = pas de vacances affichées. */
  settings(): HolidaysConfig | undefined;
  /** Fichier du dossier d'état où garder le dernier calendrier reçu. */
  path: string;
  clock: Clock;
  logger: Logger;
  status?: SourceStatus;
  fetch?: typeof fetch;
};

const savedSchema = z.object({
  version: z.literal(1),
  /** Requête (académie ou zone) qui a donné ce calendrier : un autre réglage le rend caduc. */
  filter: z.string(),
  fetchedAt: z.string(),
  holidays: z.array(z.object({ name: z.string(), start: z.string(), end: z.string().nullable() })),
});
type Saved = z.infer<typeof savedSchema>;

export function createSchoolHolidaysSource({
  settings,
  path,
  clock,
  logger,
  status,
  fetch: fetchFn = (...args) => fetch(...args),
}: SchoolHolidaysDeps): SchoolHolidaySource {
  const file = createJsonFile<Saved | null>({ path, schema: savedSchema.nullable(), initial: () => null, pretty: true });
  let failedAt: { filter: string; at: number } | undefined;
  const previews = new Map<string, { at: number; holidays: SchoolHoliday[] | null }>();
  let inFlight: Promise<void> | undefined;

  async function load(config: HolidaysConfig, filter: string): Promise<void> {
    const startedAt = clock();
    try {
      const res = await fetchFn(buildHolidaysUrl(config, localDay(startedAt)), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const records = holidaysResponseSchema.parse(await res.json());
      const holidays = parseHolidays(records);
      if (records.length > 0 && holidays.length === 0) throw new Error('aucune période lisible dans la réponse');
      await file.replace({ version: 1, filter, fetchedAt: startedAt.toISOString(), holidays });
      failedAt = undefined;
      status?.record(STATUS_NAME);
    } catch (err) {
      failedAt = { filter, at: startedAt.getTime() };
      status?.record(STATUS_NAME, err);
      const kept = (await file.read().catch(() => null))?.filter === filter ? ' ; calendrier précédent conservé' : '';
      logger.error(`${STATUS_NAME} : ${(err as Error).message}${kept}.`);
    }
  }

  const filterOf = (config: HolidaysConfig) => {
    const { field, value } = holidaysFilter(config);
    return `${field}=${value}`;
  };

  async function list(): Promise<SchoolHoliday[] | null> {
    const config = settings();
    if (!config) return null;
    const filter = filterOf(config);
    const now = clock().getTime();
    const saved = await file.read().catch((err) => {
      logger.error(`${STATUS_NAME} : ${(err as Error).message}`);
      return null;
    });
    const usable = saved?.filter === filter ? saved : null;
    const fresh = usable && now - Date.parse(usable.fetchedAt) < REFRESH_MS;
    const waiting = failedAt?.filter === filter && now - failedAt.at < RETRY_MS;
    if (!fresh && !waiting) {
      inFlight ??= load(config, filter).finally(() => (inFlight = undefined));
      // Un calendrier déjà connu reste servi pendant le rechargement ; sinon on attend le premier.
      if (!usable) await inFlight;
    }
    const latest = usable ?? (await file.read().catch(() => null));
    return latest?.filter === filter ? latest.holidays : null;
  }

  async function preview(config: HolidaysConfig): Promise<SchoolHoliday[] | null> {
    const current = settings();
    const filter = filterOf(config);
    if (current && filterOf(current) === filter) return list();
    const now = clock().getTime();
    const kept = previews.get(filter);
    if (kept && now - kept.at < (kept.holidays ? REFRESH_MS : PREVIEW_RETRY_MS)) return kept.holidays;
    let holidays: SchoolHoliday[] | null = null;
    try {
      const res = await fetchFn(buildHolidaysUrl(config, localDay(clock())), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      holidays = parseHolidays(holidaysResponseSchema.parse(await res.json()));
    } catch (err) {
      logger.error(`${STATUS_NAME} (aperçu) : ${(err as Error).message}.`);
    }
    if (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value!);
    previews.set(filter, { at: now, holidays });
    return holidays;
  }

  return {
    zone(config = settings()) {
      return config ? holidaysFilter(config).zone : null;
    },
    list,
    preview,
  };
}
