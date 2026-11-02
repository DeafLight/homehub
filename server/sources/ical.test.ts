import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOW, silentLogger } from '../testing.ts';
import { createIcalAgendaSource, occurrencesIn, parseCalendar } from './ical.ts';

const ICS = readFileSync(new URL('./fixtures/google.ics', import.meta.url), 'utf8');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const TWO_WEEKS = { from: NOW, to: days(14) };

describe('occurrencesIn', () => {
  const events = occurrencesIn(parseCalendar(ICS), TWO_WEEKS);
  const byTitle = new Map(events.map((e) => [e.title, e]));

  it('convertit les fuseaux horaires (heure de Paris → UTC)', () => {
    expect(byTitle.get('Dentiste')).toMatchObject({
      start: '2026-11-03T07:30:00.000Z',
      location: 'Cabinet du centre',
    });
  });

  it('déroule les récurrences, en tenant compte des exclusions et des occurrences déplacées', () => {
    const piscine = events.filter((e) => e.title.startsWith('Piscine')).map((e) => [e.title, e.start]);
    expect(piscine).toEqual([['Piscine (décalée)', '2026-11-11T17:00:00.000Z']]);
  });

  it('garde un événement sur la journée tant qu’il n’est pas terminé', () => {
    const birthday = byTitle.get('Anniversaire de Mamie');
    expect(birthday?.allDay).toBe(true);
    expect(new Date(birthday!.start).getDate()).toBe(2);
  });

  it('écarte les événements passés et annulés', () => {
    expect(byTitle.has('Déjà passé')).toBe(false);
    expect(byTitle.has('Annulé')).toBe(false);
  });

  it('s’arrête à la fin de l’intervalle', () => {
    expect(occurrencesIn(parseCalendar(ICS), { from: NOW, to: days(0.5) }).map((e) => e.title)).toEqual([
      'Anniversaire de Mamie',
    ]);
  });
});

describe('createIcalAgendaSource', () => {
  const SECRETS: Record<string, string> = {
    CAL_ALEX: 'https://exemple.test/secret-alex/basic.ics',
    CAL_FAMILLE: 'https://exemple.test/secret-famille/basic.ics',
  };

  function setup(calendars: Record<string, string[]>, fail: string[] = []) {
    const logger = silentLogger();
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      if (fail.includes(url)) return new Response('', { status: 404 });
      return new Response(ICS);
    }) as typeof fetch;
    const source = createIcalAgendaSource({
      calendarsFor: (ownerId) => calendars[ownerId] ?? [],
      refreshMinutes: () => 10,
      secret: (name) => SECRETS[name],
      clock: () => NOW,
      logger,
      fetch: fetchFn,
    });
    return { source, logger, calls };
  }

  it('fusionne les agendas d’un profil, sans doublon, triés par date', async () => {
    const { source } = setup({ alex: ['CAL_ALEX', 'CAL_FAMILLE'] });
    const events = await source.eventsFor('alex', TWO_WEEKS);
    expect(events.map((e) => e.title)).toEqual(['Anniversaire de Mamie', 'Dentiste', 'Piscine (décalée)']);
  });

  it('ne retélécharge pas un agenda avant refreshMinutes', async () => {
    const { source, calls } = setup({ alex: ['CAL_ALEX'] });
    await source.eventsFor('alex', TWO_WEEKS);
    await source.eventsFor('alex', TWO_WEEKS);
    expect(calls).toHaveLength(1);
  });

  it('un profil sans agenda n’a pas d’événement', async () => {
    const { source, calls } = setup({});
    expect(await source.eventsFor('lea', TWO_WEEKS)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('signale une seule fois une variable absente', async () => {
    const { source, logger } = setup({ alex: ['CAL_INCONNU'] });
    await source.eventsFor('alex', TWO_WEEKS);
    await source.eventsFor('alex', TWO_WEEKS);
    expect(logger.errors).toEqual([expect.stringContaining('CAL_INCONNU')]);
  });

  it('un agenda en erreur n’empêche pas d’afficher les autres, et son adresse secrète reste hors des logs', async () => {
    const { source, logger } = setup({ alex: ['CAL_ALEX', 'CAL_FAMILLE'] }, [SECRETS.CAL_FAMILLE]);
    expect(await source.eventsFor('alex', TWO_WEEKS)).toHaveLength(3);
    expect(logger.errors).toEqual([expect.stringContaining('Agenda CAL_FAMILLE : HTTP 404')]);
    expect(logger.errors.join()).not.toContain('secret');
  });
});
