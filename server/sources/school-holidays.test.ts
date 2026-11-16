// Tests des vacances scolaires : lecture du calendrier officiel (fixture au format réel de l'API), lecture page par
// page et filtre local, cache d'un jour gardé sur le disque, calendrier précédent conservé en cas de panne.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.ts';
import { silentLogger, testConfig } from '../testing.ts';
import {
  buildHolidaysPageUrl,
  createSchoolHolidaysSource,
  fetchAllHolidayRecords,
  findAcademie,
  holidayName,
  holidaysFilter,
  parseHolidays,
  selectHolidayRecords,
} from './school-holidays.ts';
import { fakeHolidaysPage, readHolidaysFixture } from './school-holidays-fake.ts';
import { createSourceStatus } from './source-status.ts';

/**
 * Académie de Nantes, juillet 2026 → été 2028 (lignes réelles de l'API), plus un Noël passé de Nantes et quelques
 * lignes de Rennes (zone B) et de Bordeaux (zone A) pour le filtre local.
 */
const FIXTURE = readHolidaysFixture();
const NANTES = (today: string) => selectHolidayRecords(FIXTURE, { academie: 'Nantes' }, today);
/** Lignes d'une autre académie, pour un jeu de plusieurs pages. */
const padding = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    description: 'Vacances de la Toussaint',
    population: '-',
    start_date: `2018-10-${String((i % 28) + 1).padStart(2, '0')}T22:00:00+00:00`,
    end_date: '2018-11-04T23:00:00+00:00',
    location: 'Corse',
    zones: 'Corse',
    annee_scolaire: '2018-2019',
  }));
const readFileOrNull = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const record = (description: string, population: string, start: string, end: string, annee = '2026-2027') => ({
  description, population, start_date: start, end_date: end, location: 'Guadeloupe', zones: 'Guadeloupe', annee_scolaire: annee,
});

describe('calendrier scolaire : lecture', () => {
  it('périodes de la fixture : reprise des élèves, pont d’un jour, été sans reprise publiée', () => {
    expect(parseHolidays(NANTES('2026-07-01'))).toEqual([
      { name: 'Vacances d’été', start: '2026-07-04', end: '2026-09-01' },
      { name: 'Vacances de la Toussaint', start: '2026-10-17', end: '2026-11-02' },
      { name: 'Vacances de Noël', start: '2026-12-19', end: '2027-01-04' },
      { name: 'Vacances d’hiver', start: '2027-02-20', end: '2027-03-08' },
      { name: 'Vacances de printemps', start: '2027-04-17', end: '2027-05-03' },
      // Début = fin (vendredi 7 mai) : reprise le lundi.
      { name: 'Pont de l’Ascension', start: '2027-05-07', end: '2027-05-10' },
      // Élèves (2 septembre), pas enseignants (1er septembre).
      { name: 'Vacances d’été', start: '2027-07-03', end: '2027-09-02' },
      { name: 'Vacances de la Toussaint', start: '2027-10-23', end: '2027-11-08' },
      { name: 'Vacances de Noël', start: '2027-12-18', end: '2028-01-03' },
      { name: 'Vacances d’hiver', start: '2028-02-05', end: '2028-02-21' },
      { name: 'Vacances de printemps', start: '2028-04-08', end: '2028-04-24' },
      { name: 'Pont de l’Ascension', start: '2028-05-25', end: '2028-05-29' },
      { name: 'Vacances d’été', start: '2028-07-04', end: null },
    ]);
  });

  it('outre-mer : les vacances de tous avant un sous-territoire, jamais celles des enseignants seules', () => {
    const holidays = parseHolidays([
      record('Abolition de l’esclavage', 'Saint-Martin', '2027-05-27T22:00:00+00:00', '2027-05-28T22:00:00+00:00'),
      record('Abolition de l’esclavage', 'Guadeloupe sauf Saint-Martin', '2027-05-26T22:00:00+00:00', '2027-05-27T22:00:00+00:00'),
      record('Vacances de Carnaval', 'Enseignants', '2027-02-04T23:00:00+00:00', '2027-02-21T23:00:00+00:00'),
      record('Vacances de Carnaval', '-', '2027-02-05T23:00:00+00:00', '2027-02-21T23:00:00+00:00'),
      record('Pré-rentrée', 'Enseignants', '2027-08-30T22:00:00+00:00', '2027-08-31T22:00:00+00:00'),
      { description: 'illisible' },
    ]);
    expect(holidays).toEqual([
      { name: 'Vacances de Carnaval', start: '2027-02-06', end: '2027-02-22' },
      { name: 'Abolition de l’esclavage', start: '2027-05-27', end: '2027-05-28' },
    ]);
  });

  it('jour local quel que soit le fuseau du territoire (Réunion +4 h, Polynésie -10 h)', () => {
    const [reunion, polynesie] = [
      parseHolidays([record('Vacances de Noël', '-', '2026-12-18T20:00:00+00:00', '2027-01-03T20:00:00+00:00')]),
      parseHolidays([record('Vacances de Noël', '-', '2026-12-19T10:00:00+00:00', '2027-01-04T10:00:00+00:00')]),
    ];
    expect(reunion).toEqual(polynesie);
    expect(reunion[0]).toMatchObject({ start: '2026-12-19', end: '2027-01-04' });
  });

  it('noms à la française', () => {
    expect(holidayName("Vacances d'Hiver")).toBe('Vacances d’hiver');
    expect(holidayName("Début des Vacances d'Été")).toBe('Vacances d’été');
    expect(holidayName('Vacances de la Toussaint')).toBe('Vacances de la Toussaint');
    expect(holidayName("Pont de l'Ascension")).toBe('Pont de l’Ascension');
  });
});

describe('calendrier scolaire : réglage et requête', () => {
  it('académie écrite à la main, anciens noms, zone', () => {
    expect(findAcademie('orleans tours')).toBe('Orléans-Tours');
    expect(findAcademie('CAEN')).toBe('Normandie');
    expect(findAcademie('Atlantide')).toBeUndefined();
    expect(holidaysFilter({ academie: 'nantes' })).toEqual({ field: 'location', value: 'Nantes', zone: 'Zone B' });
    expect(holidaysFilter({ academie: 'Corse' })).toEqual({ field: 'location', value: 'Corse', zone: 'Corse' });
    expect(holidaysFilter({ zone: 'C' })).toEqual({ field: 'zones', value: 'Zone C', zone: 'Zone C' });
  });

  it('URL : pages brutes de 100 lignes, sans filtre ni tri (seule forme acceptée sans clé)', () => {
    const url = new URL(buildHolidaysPageUrl(200));
    expect(url.hostname).toBe('data.education.gouv.fr');
    expect(url.pathname).toMatch(/\/records$/);
    expect(url.search).toBe('?limit=100&offset=200');
    expect(fakeHolidaysPage(FIXTURE, url).status).toBe(200);
    expect(fakeHolidaysPage(FIXTURE, `${url}&where=zones%3D%22Zone%20B%22`).status).toBe(401);
  });

  it('filtre local : académie ou zone, périodes finies depuis moins de 30 jours, triées', () => {
    const nantes = NANTES('2026-11-11') as { location: string; start_date: string }[];
    expect(nantes).toHaveLength(13); // ni l’été 2026 ni le Noël 2025, finis avant le 12 octobre
    expect(nantes.every((r) => r.location === 'Nantes')).toBe(true);
    expect(nantes.map((r) => r.start_date)).toEqual(nantes.map((r) => r.start_date).sort());
    // Zone B : Nantes et Rennes, mêmes dates, une seule période par vacances.
    const zoneB = selectHolidayRecords(FIXTURE, { zone: 'B' }, '2026-11-11');
    expect(zoneB).toHaveLength(15);
    expect(parseHolidays(zoneB)).toEqual(parseHolidays(nantes));
    const zoneA = parseHolidays(selectHolidayRecords(FIXTURE, { zone: 'A' }, '2026-11-11'));
    expect(zoneA.map((h) => h.start)).toEqual(['2026-12-19', '2027-02-06']);
  });

  it('lecture de tout le jeu, page par page jusqu’au total', async () => {
    const all = [...padding(250), ...FIXTURE];
    const calls: string[] = [];
    const records = await fetchAllHolidayRecords(async (url) => {
      calls.push(String(url));
      return fakeHolidaysPage(all, String(url));
    });
    expect(records).toEqual(all);
    expect(calls.map((u) => new URL(u).search)).toEqual(['?limit=100&offset=0', '?limit=100&offset=100', '?limit=100&offset=200']);
  });

  it('lecture incomplète : une page en échec, un total qui change, un jeu vide font tout échouer', async () => {
    const all = padding(250);
    const page2Down = async (url: string | URL | Request) =>
      String(url).endsWith('offset=100') ? new Response(null, { status: 401 }) : fakeHolidaysPage(all, String(url));
    await expect(fetchAllHolidayRecords(page2Down)).rejects.toThrow('HTTP 401');
    let pages = 0;
    const republished = async (url: string | URL | Request) => fakeHolidaysPage(pages++ === 0 ? all : [...all, ...FIXTURE], String(url));
    await expect(fetchAllHolidayRecords(republished)).rejects.toThrow(/modifié/);
    await expect(fetchAllHolidayRecords(async (url) => fakeHolidaysPage([], String(url)))).rejects.toThrow(/vide/);
  });

  it('configuration : académie ou zone, pas les deux, académie connue', () => {
    const base = { members: testConfig.members };
    expect(parseConfig({ ...base, holidays: { academie: 'Nantes' } }).holidays).toEqual({ academie: 'Nantes' });
    expect(parseConfig({ ...base, holidays: { zone: 'B' } }).holidays).toEqual({ zone: 'B' });
    expect(parseConfig(base).holidays).toBeUndefined();
    expect(() => parseConfig({ ...base, holidays: { zone: 'B', academie: 'Nantes' } })).toThrow(/pas les deux/);
    expect(() => parseConfig({ ...base, holidays: {} })).toThrow(/pas les deux/);
    expect(() => parseConfig({ ...base, holidays: { academie: 'Atlantide' } })).toThrow(/académie inconnue/);
    expect(() => parseConfig({ ...base, holidays: { zone: 'D' } })).toThrow();
  });
});

describe('calendrier scolaire : cache', () => {
  function setup(
    settings: { academie?: string; zone?: 'A' | 'B' | 'C' } | null = { academie: 'Nantes' },
    path?: string,
    records: unknown[] = FIXTURE,
  ) {
    let now = new Date('2026-11-11T08:00:00Z').getTime();
    const calls: string[] = [];
    let failing: boolean | 'page2' = false;
    const logger = silentLogger();
    const status = createSourceStatus(() => new Date(now));
    const file = path ?? join(mkdtempSync(join(tmpdir(), 'homehub-holidays-')), 'school-holidays.json');
    const source = createSchoolHolidaysSource({
      settings: () => settings ?? undefined,
      path: file,
      clock: () => new Date(now),
      logger,
      status,
      fetch: async (url) => {
        calls.push(String(url));
        const down = failing === true || (failing === 'page2' && String(url).endsWith('offset=100'));
        return down ? new Response('panne', { status: 503 }) : fakeHolidaysPage(records, String(url));
      },
    });
    return {
      source, calls, logger, status, file,
      advance: (ms: number) => void (now += ms),
      fail: (value: boolean | 'page2') => void (failing = value),
    };
  }
  const HOUR = 3_600_000;

  it('non configuré : null, sans requête', async () => {
    const t = setup(null);
    expect(await t.source.list()).toBeNull();
    expect(t.calls).toHaveLength(0);
  });

  it('une requête par jour au plus', async () => {
    const t = setup();
    expect(await t.source.list()).toHaveLength(12);
    t.advance(23 * HOUR);
    await t.source.list();
    expect(t.calls).toHaveLength(1);
    t.advance(2 * HOUR);
    await t.source.list();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.calls).toHaveLength(2);
    expect(t.status.list()).toMatchObject([{ name: 'Vacances scolaires', ok: true }]);
  });

  it('panne : calendrier précédent conservé, nouvel essai une heure après', async () => {
    const t = setup();
    await t.source.list();
    t.fail(true);
    t.advance(25 * HOUR);
    expect(await t.source.list()).toHaveLength(12);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.logger.errors[0]).toMatch(/HTTP 503 ; calendrier précédent conservé/);
    expect(t.status.list()).toMatchObject([{ name: 'Vacances scolaires', ok: false }]);
    await t.source.list();
    expect(t.calls).toHaveLength(2);
    t.advance(HOUR);
    await t.source.list();
    expect(t.calls).toHaveLength(3);
  });

  it('une seule page en échec : l’état gardé n’est pas écrasé', async () => {
    const t = setup({ academie: 'Nantes' }, undefined, [...padding(250), ...FIXTURE]);
    expect(await t.source.list()).toHaveLength(12);
    expect(t.calls).toHaveLength(3);
    const saved = readFileOrNull(t.file);
    t.fail('page2');
    t.advance(25 * HOUR);
    expect(await t.source.list()).toHaveLength(12);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.calls).toHaveLength(5); // page 1 lue, page 2 en échec, pas de page 3
    expect(readFileOrNull(t.file)).toBe(saved);
    expect(t.logger.errors[0]).toMatch(/HTTP 503 ; calendrier précédent conservé/);
    expect(t.status.list()).toMatchObject([{ name: 'Vacances scolaires', ok: false }]);
  });

  it('redémarrage pendant une panne : le calendrier gardé sur le disque reste servi', async () => {
    const first = setup();
    await first.source.list();
    const second = setup({ academie: 'Nantes' }, first.file);
    second.fail(true);
    second.advance(48 * HOUR);
    expect(await second.source.list()).toHaveLength(12);
  });

  it('jamais reçu et API en panne : null ; autre réglage : l’ancien calendrier ne sert plus', async () => {
    const t = setup();
    t.fail(true);
    expect(await t.source.list()).toBeNull();
    const nantes = setup();
    await nantes.source.list();
    const other = setup({ zone: 'A' }, nantes.file);
    other.fail(true);
    expect(await other.source.list()).toBeNull();
  });

  it('aperçu d’un autre réglage : en mémoire seulement, depuis le jeu déjà lu, le réglage en cours passe par le cache', async () => {
    const t = setup();
    expect(await t.source.preview({ zone: 'A' })).toHaveLength(2);
    expect(await t.source.preview({ zone: 'B' })).toHaveLength(12);
    expect(t.calls).toHaveLength(1); // un seul jeu complet pour tous les réglages
    expect(t.source.zone({ academie: 'Corse' })).toBe('Corse');
    expect(readFileOrNull(t.file)).toBeNull(); // l'aperçu n'écrit rien
    expect(await t.source.preview({ academie: 'nantes' })).toHaveLength(12); // réglage en cours : list()
    expect(readFileOrNull(t.file)).toContain('location=Nantes');
    expect(t.calls).toHaveLength(1);
    t.fail(true);
    t.advance(25 * 3_600_000);
    expect(await t.source.preview({ zone: 'C' })).toBeNull();
    expect(t.logger.errors.at(-1)).toMatch(/aperçu/);
    const calls = t.calls.length;
    await t.source.preview({ zone: 'C' });
    expect(t.calls).toHaveLength(calls); // échec gardé 5 minutes
  });
});
