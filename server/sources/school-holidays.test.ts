// Tests des vacances scolaires : lecture du calendrier officiel (fixture au format réel de l'API), requête, cache d'un
// jour gardé sur le disque, calendrier précédent conservé en cas de panne.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config.ts';
import { silentLogger, testConfig } from '../testing.ts';
import {
  buildHolidaysUrl,
  createSchoolHolidaysSource,
  findAcademie,
  holidayName,
  holidaysFilter,
  parseHolidays,
} from './school-holidays.ts';
import { createSourceStatus } from './source-status.ts';

/** Académie de Nantes, juillet 2026 → été 2028 (réponse réelle de l'API, export JSON). */
const FIXTURE: unknown[] = JSON.parse(readFileSync(new URL('./fixtures/calendrier-scolaire.json', import.meta.url), 'utf8'));
const readFileOrNull = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const record = (description: string, population: string, start: string, end: string, annee = '2026-2027') => ({
  description, population, start_date: start, end_date: end, location: 'Guadeloupe', zones: 'Guadeloupe', annee_scolaire: annee,
});

describe('calendrier scolaire : lecture', () => {
  it('périodes de la fixture : reprise des élèves, pont d’un jour, été sans reprise publiée', () => {
    expect(parseHolidays(FIXTURE)).toEqual([
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

  it('URL : filtre et périodes finies depuis moins de 30 jours', () => {
    const url = new URL(buildHolidaysUrl({ academie: 'Nantes' }, '2026-11-11'));
    expect(url.hostname).toBe('data.education.gouv.fr');
    expect(url.searchParams.get('where')).toBe('location="Nantes" and end_date>="2026-10-12"');
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
  function setup(settings: { academie?: string; zone?: 'A' | 'B' | 'C' } | null = { academie: 'Nantes' }, path?: string) {
    let now = new Date('2026-11-11T08:00:00Z').getTime();
    const calls: string[] = [];
    let failing = false;
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
        return failing ? new Response('panne', { status: 503 }) : Response.json(FIXTURE);
      },
    });
    return {
      source, calls, logger, status, file,
      advance: (ms: number) => void (now += ms),
      fail: (value: boolean) => void (failing = value),
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
    expect(await t.source.list()).toHaveLength(13);
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
    expect(await t.source.list()).toHaveLength(13);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.logger.errors[0]).toMatch(/HTTP 503 ; calendrier précédent conservé/);
    expect(t.status.list()).toMatchObject([{ name: 'Vacances scolaires', ok: false }]);
    await t.source.list();
    expect(t.calls).toHaveLength(2);
    t.advance(HOUR);
    await t.source.list();
    expect(t.calls).toHaveLength(3);
  });

  it('redémarrage pendant une panne : le calendrier gardé sur le disque reste servi', async () => {
    const first = setup();
    await first.source.list();
    const second = setup({ academie: 'Nantes' }, first.file);
    second.fail(true);
    second.advance(48 * HOUR);
    expect(await second.source.list()).toHaveLength(13);
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

  it('aperçu d’un autre réglage : en mémoire seulement, une requête par jour, le réglage en cours passe par le cache', async () => {
    const t = setup();
    expect(await t.source.preview({ zone: 'A' })).toHaveLength(13);
    expect(t.calls[0]).toContain(encodeURIComponent('zones="Zone A"').replace(/%20/g, '+'));
    await t.source.preview({ zone: 'A' });
    expect(t.calls).toHaveLength(1);
    expect(t.source.zone({ academie: 'Corse' })).toBe('Corse');
    expect(readFileOrNull(t.file)).toBeNull(); // l'aperçu n'écrit rien
    expect(await t.source.preview({ academie: 'nantes' })).toHaveLength(13); // réglage en cours : list()
    expect(readFileOrNull(t.file)).toContain('location=Nantes');
    t.fail(true);
    expect(await t.source.preview({ zone: 'C' })).toBeNull();
    expect(t.logger.errors.at(-1)).toMatch(/aperçu/);
    await t.source.preview({ zone: 'C' });
    expect(t.calls).toHaveLength(3); // échec gardé 5 minutes
  });
});
