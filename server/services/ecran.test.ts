// Tests de l'écran de veille de la télé : rendez-vous d'aujourd'hui et de demain (finis écartés, journée entière
// d'abord, doublons d'un agenda partagé au nom de la famille, au plus 6), menu du jour, jours de prévision suivants,
// et assemblage (semaine suivante lue le dimanche, rien de personnel dans la réponse).
import { describe, expect, it } from 'vitest';
import { ECRAN_EVENTS_MAX } from '../../shared/ecran.ts';
import type { MenuEntry } from '../../shared/menu.ts';
import { FAMILY_ID, type CalendarEvent, type WeekData } from '../../shared/types.ts';
import type { Household } from '../household.ts';
import type { MenuStore } from '../sources/menus.ts';
import type { RecipeStore } from '../sources/recipes.ts';
import { NOW, testForecast, testWeather } from '../testing.ts';
import type { DashboardService } from './dashboard.ts';
import { createEcranService, dinnerOf, ecranAgenda, nextDays } from './ecran.ts';

const at = (days: number, hours: number, minutes = 0) => new Date(2026, 10, 2 + days, hours, minutes).toISOString();
const names: Record<string, string> = { alex: 'Alex', lea: 'Léa' };
const nameOf = (id: string) => names[id] ?? id;
const week = (owners: Record<string, CalendarEvent[]>): WeekData => ({
  start: new Date(2026, 10, 2).toISOString(),
  offset: 0,
  owners: Object.entries(owners).map(([ownerId, events]) => ({ ownerId, events, courses: null })),
});

describe('écran de veille : agenda', () => {
  it("garde aujourd'hui (pas fini) et demain, triés par jour, journée entière d'abord", () => {
    const agenda = ecranAgenda(
      [
        week({
          [FAMILY_ID]: [
            { id: 'passe', title: 'Courses', start: at(0, 10), end: at(0, 11) },
            { id: 'cine', title: 'Cinéma', start: at(0, 20, 30), end: at(0, 22, 30) },
            { id: 'brocante', title: 'Brocante', start: at(1, 0), end: at(2, 0), allDay: true },
            { id: 'loin', title: 'Mamie', start: at(2, 12) },
          ],
          lea: [
            { id: 'en-cours', title: 'Piscine', start: at(0, 17, 30), end: at(0, 18, 30) },
            { id: 'judo', title: 'Judo', start: at(1, 9) },
          ],
        }),
      ],
      nameOf,
      NOW,
    );
    expect(agenda.map((e) => [e.title, e.who])).toEqual([
      ['Piscine', 'Léa'],
      ['Cinéma', null],
      ['Brocante', null],
      ['Judo', 'Léa'],
    ]);
  });

  it("un même rendez-vous sur plusieurs profils : une fois, au nom de la famille ; au plus 6", () => {
    const shared = { id: 'x', title: 'Dîner chez Sam', start: at(0, 19) };
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, title: `Rendez-vous ${i}`, start: at(1, 8 + i) }));
    const agenda = ecranAgenda([week({ alex: [shared], [FAMILY_ID]: [{ ...shared, id: 'y' }], lea: many })], nameOf, NOW);
    expect(agenda[0]).toMatchObject({ title: 'Dîner chez Sam', who: null });
    expect(agenda).toHaveLength(ECRAN_EVENTS_MAX);
  });

  it("un rendez-vous de plusieurs jours commencé hier compte pour aujourd'hui", () => {
    const agenda = ecranAgenda(
      [week({ [FAMILY_ID]: [{ id: 'm', title: 'Matin', start: at(1, 8) }, { id: 'v', title: 'Grand-parents', start: at(-1, 0), end: at(2, 0), allDay: true }] })],
      nameOf,
      NOW,
    );
    expect(agenda.map((e) => e.title)).toEqual(['Grand-parents', 'Matin']);
  });
});

describe('écran de veille : menu et météo', () => {
  const entry = (id: string, day: string | null, title = id): MenuEntry => ({
    id,
    recipeId: `r-${id}`,
    title,
    people: 4,
    day,
    addedBy: { ownerId: 'alex', via: 'phone' },
    addedAt: NOW.toISOString(),
  });

  it('recettes du jour seulement, au titre actuel de la recette', () => {
    const entries = [entry('a', '2026-11-02', 'Lentilles'), entry('b', null), entry('c', '2026-11-03'), entry('d', '2026-11-02', 'Tarte')];
    expect(dinnerOf(entries, '2026-11-02', (id) => (id === 'r-a' ? 'Lentilles corail' : null))).toEqual(['Lentilles corail', 'Tarte']);
  });

  it("jours de prévision après aujourd'hui, 3 au plus", () => {
    const day = (offset: number) => ({ date: at(offset, 0), weatherCode: 1, minC: 2, maxC: 9, precipitationMm: 0, windMaxKmh: 10, sunrise: null, sunset: null });
    const forecast = { ...testForecast, days: [day(0), day(1), day(2), day(3), day(4)] };
    expect(nextDays(forecast, NOW).map((d) => d.date)).toEqual([at(1, 0), at(2, 0), at(3, 0)]);
    expect(nextDays(null, NOW)).toEqual([]);
  });
});

describe('écran de veille : assemblage', () => {
  function setup(now: Date) {
    const weeks: number[] = [];
    const service = {
      home: async () => ({ weather: testWeather, profiles: [], familyHighlight: null, holiday: null }),
      weatherForecast: async () => testForecast,
      week: async (offset: number) => (weeks.push(offset), week({ [FAMILY_ID]: [{ id: 'f', title: 'Foot', start: at(offset * 7 + 6, 20) }] })),
    } as unknown as DashboardService;
    const menus = {
      data: async () => ({ weeks: { '2026-11-02': [{ id: 'm', recipeId: 'r1', title: 'Soupe', people: 4, day: '2026-11-08', addedBy: { ownerId: 'alex', via: 'phone' }, addedAt: '' }] } }),
    } as unknown as MenuStore;
    const recipes = { get: async () => null } as unknown as RecipeStore;
    const household = { nameOf } as unknown as Household;
    return { weeks, ecran: createEcranService({ service, menus, recipes, household, clock: () => now }) };
  }

  it('le dimanche, demain est dans la semaine suivante : les deux sont lues ; menu du jour', async () => {
    const { weeks, ecran } = setup(new Date(2026, 10, 8, 18));
    const data = await ecran.data();
    expect(weeks).toEqual([0, 1]);
    expect(data).toEqual({ weather: testWeather, days: [], agenda: [expect.objectContaining({ title: 'Foot', who: null })], dinner: ['Soupe'], holiday: null });
  });

  it('en semaine : la semaine en cours seulement', async () => {
    const { weeks, ecran } = setup(NOW);
    expect((await ecran.data()).dinner).toEqual([]);
    expect(weeks).toEqual([0]);
  });
});
