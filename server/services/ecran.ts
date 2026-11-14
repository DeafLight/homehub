// Écran de veille de la télé (fonction 8) : assemble ce que la page /ecran affiche, à partir de ce que la tablette
// montre déjà à tous : météo du moment et des jours suivants, agenda d'aujourd'hui et de demain (famille et membres,
// comme la semaine de la tablette), recettes du menu du jour, vacances. Rien de personnel (ni tâches, ni mots, ni
// sport, ni vie scolaire). Les choix (quels rendez-vous, quels jours) sont des fonctions pures, testées à part.
import { ECRAN_DAYS, ECRAN_EVENTS_MAX, type EcranData, type EcranEvent } from '../../shared/ecran.ts';
import { localDay } from '../../shared/dates.ts';
import { weekOf, type MenuEntry } from '../../shared/menu.ts';
import { FAMILY_ID, type WeatherForecast, type WeatherDay, type WeekData } from '../../shared/types.ts';
import type { Household } from '../household.ts';
import type { MenuStore } from '../sources/menus.ts';
import type { RecipeStore } from '../sources/recipes.ts';
import type { Clock } from '../sources/types.ts';
import type { DashboardService } from './dashboard.ts';

const DAY_MS = 86_400_000;

/** Minuit local du jour de `date`, plus `days` jours. */
function midnight(date: Date, days = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Rendez-vous d'aujourd'hui (pas encore finis) et de demain, tous profils confondus, triés par début ; un même
 * événement vu sur plusieurs profils (agenda partagé) n'apparaît qu'une fois, au nom de la famille s'il y est.
 */
export function ecranAgenda(weeks: readonly WeekData[], nameOf: (ownerId: string) => string, now: Date): EcranEvent[] {
  const from = now.getTime();
  const to = midnight(now, 2).getTime();
  const seen = new Map<string, EcranEvent>();
  for (const week of weeks) {
    for (const owner of week.owners) {
      for (const event of owner.events) {
        const start = new Date(event.start).getTime();
        const end = event.end ? new Date(event.end).getTime() : start + (event.allDay ? DAY_MS : 0);
        if (start >= to || end < from) continue;
        const key = `${event.title}|${event.start}`;
        const who = owner.ownerId === FAMILY_ID ? null : nameOf(owner.ownerId);
        const known = seen.get(key);
        if (known && (known.who === null || who !== null)) continue;
        seen.set(key, { id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay, who });
      }
    }
  }
  // Par jour (un rendez-vous commencé hier compte pour aujourd'hui), la journée entière d'abord, puis par heure.
  const dayOf = (e: EcranEvent) => Math.max(new Date(e.start).getTime(), midnight(now).getTime());
  return [...seen.values()]
    .sort((a, b) => midnight(new Date(dayOf(a))).getTime() - midnight(new Date(dayOf(b))).getTime() || Number(!a.allDay) - Number(!b.allDay) || new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, ECRAN_EVENTS_MAX);
}

/** Recettes au menu ce jour-là (les repas « cette semaine », sans jour, n'y sont pas), au titre actuel de la recette. */
export function dinnerOf(entries: readonly MenuEntry[], today: string, titleOf: (recipeId: string) => string | null): string[] {
  return entries.filter((e) => e.day === today).map((e) => titleOf(e.recipeId) ?? e.title);
}

/** Les jours de prévision qui suivent aujourd'hui (ECRAN_DAYS au plus). */
export function nextDays(forecast: WeatherForecast | null, now: Date): WeatherDay[] {
  const today = localDay(now);
  return (forecast?.days ?? []).filter((d) => localDay(new Date(d.date)) > today).slice(0, ECRAN_DAYS);
}

export type EcranService = { data(): Promise<EcranData> };

export function createEcranService({
  service,
  menus,
  recipes,
  household,
  clock,
}: {
  service: DashboardService;
  menus: MenuStore;
  recipes: RecipeStore;
  household: Household;
  clock: Clock;
}): EcranService {
  async function dinner(now: Date): Promise<string[]> {
    const entries = (await menus.data()).weeks[weekOf(now)] ?? [];
    const today = entries.filter((e) => e.day === localDay(now));
    const titles = new Map(await Promise.all(today.map(async (e) => [e.recipeId, (await recipes.get(e.recipeId))?.ours.title ?? null] as const)));
    return dinnerOf(today, localDay(now), (id) => titles.get(id) ?? null);
  }

  return {
    async data() {
      const now = clock();
      // Demain dans la semaine suivante (dimanche) : elle aussi.
      const offsets = weekOf(midnight(now, 1)) === weekOf(now) ? [0] : [0, 1];
      const [home, forecast, weeks, meal] = await Promise.all([
        service.home(),
        service.weatherForecast(),
        Promise.all(offsets.map((o) => service.week(o))),
        dinner(now),
      ]);
      return {
        weather: home.weather,
        days: nextDays(forecast, now),
        agenda: ecranAgenda(weeks, household.nameOf, now),
        dinner: meal,
        holiday: home.holiday,
      };
    },
  };
}
