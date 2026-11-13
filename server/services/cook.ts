// « J'ai cuisiné » côté serveur, sans HTTP : la proposition (recalculée ici avec shared/cook.ts, jamais reprise du
// front), le décompte (chaque réponse vérifiée contre sa ligne, mouvements du stock groupés, repas noté cuisiné d'un
// coup avec ce qu'il efface), la liste de courses pour les produits épuisés, et l'annulation. Ordre du décompte : le
// repas est noté d'abord (un second appui, ou l'autre appareil, est refusé), puis le stock ; si le stock échoue, le
// repas redevient « pas cuisiné ». Hors menu : mêmes lignes et mouvements, aucun repas marqué, aucune coche touchée.
import { randomUUID } from 'node:crypto';
import {
  answerEffect,
  type CookedMark,
  cookLines,
  type CookMeal,
  type CookProposal,
  type CookRequest,
  type CookResult,
  type CookUndo,
  cookWindow,
  defaultMeal,
  effectLabel,
  finishesPack,
  validAnswer,
} from '../../shared/cook.ts';
import { addWeeks, eaten, MENU_LIMITS, type MenuEntry, weekOf } from '../../shared/menu.ts';
import type { Recipe } from '../../shared/recipes.ts';
import { localDay } from '../../shared/dates.ts';
import type { Author } from '../../shared/types.ts';
import type { ListsStore } from '../sources/lists.ts';
import type { MenuStore } from '../sources/menus.ts';
import type { RecipeStore } from '../sources/recipes.ts';
import { type CookChange, shoppingLabel, type StockStore } from '../sources/stock.ts';
import type { Clock } from '../sources/types.ts';
import type { MenuService } from './menu.ts';

/** Refus métier, traduit en réponse par la couche HTTP. */
export type CookRefusal = {
  refused: 'unknown-recipe' | 'unknown-meal' | 'closed' | 'already' | 'mismatch' | 'invalid' | 'not-cooked' | 'unknown-cook';
  message?: string;
};

export const isCookRefusal = (value: unknown): value is CookRefusal => typeof value === 'object' && value !== null && 'refused' in value;

export type CookService = {
  /** Proposition pour un repas (`entryId`), ou pour une recette (`entryId` undefined : repas pris d'office ; null : hors menu). */
  proposal(input: { recipeId: string | null; entryId?: string | null; people: number | null }): Promise<CookProposal | CookRefusal>;
  cook(recipeId: string | null, request: CookRequest, by: Author): Promise<CookResult | CookRefusal>;
  /** Annule un décompte par son identifiant (repas ou hors menu). */
  undo(cook: string): Promise<CookUndo | CookRefusal>;
  /** Annule le décompte d'un repas. */
  uncook(entryId: string): Promise<CookUndo | CookRefusal>;
  /** Repas passés pas encore notés (semaine en cours, et la précédente pendant ses deux jours de plus). */
  reminder(): Promise<{ count: number }>;
};

export type CookServiceDeps = { menus: MenuStore; recipes: RecipeStore; stock: StockStore; lists: ListsStore; menu: MenuService; clock: Clock };

const refuse = (refused: CookRefusal['refused'], message?: string): CookRefusal => ({ refused, ...(message && { message }) });

export function createCookService({ menus, recipes, stock, lists, menu, clock }: CookServiceDeps): CookService {
  const today = () => localDay(clock());

  /** Semaines dont les repas se notent encore : la semaine en cours, et la précédente pendant ses jours de plus. */
  function openWeeks(): string[] {
    const current = weekOf(clock());
    const previous = addWeeks(current, -1);
    return cookWindow(previous, today()) ? [current, previous] : [current];
  }

  async function findEntry(id: string): Promise<{ week: string; entry: MenuEntry } | null> {
    const { weeks } = await menus.data();
    for (const [week, entries] of Object.entries(weeks)) {
      const entry = entries.find((e) => e.id === id);
      if (entry) return { week, entry };
    }
    return null;
  }

  const mealOf = (week: string, entry: MenuEntry, recipe: Recipe | null): CookMeal => ({
    id: entry.id,
    week,
    day: entry.day,
    people: entry.people,
    title: recipe?.ours.title ?? entry.title,
    cooked: entry.cooked ?? null,
  });

  /** Repas d'une recette dans les semaines encore ouvertes. */
  async function mealsOf(recipe: Recipe): Promise<CookMeal[]> {
    const { weeks } = await menus.data();
    return openWeeks().flatMap((week) => (weeks[week] ?? []).filter((e) => e.recipeId === recipe.id).map((e) => mealOf(week, e, recipe)));
  }

  const clampPeople = (n: number | null) => (n === null ? null : Math.min(MENU_LIMITS.people, Math.max(1, Math.round(n))));

  async function proposalFor(recipe: Recipe | null, meal: CookMeal | null, meals: CookMeal[], people: number | null, title: string): Promise<CookProposal> {
    const shown = clampPeople(people ?? meal?.people ?? recipe?.ours.servings ?? null);
    const lines = recipe ? cookLines(recipe.ours, shown, await menu.cookContext()) : [];
    return { recipeId: recipe?.id ?? null, title, meal, meals, people: shown, servingsUnit: recipe?.ours.servingsUnit ?? null, missing: recipe === null, lines };
  }

  /** Ajouté d'office ou proposé pour la liste de courses ; déjà sur la liste : rien. */
  async function shoppingFor(outs: { code: string; movementId: string; exhausted: boolean; autoShop: boolean }[], by: Author) {
    const propose: { code: string; label: string }[] = [];
    const added: string[] = [];
    const seen = new Set<string>();
    for (const out of outs) {
      if (!out.exhausted || seen.has(out.code)) continue;
      seen.add(out.code);
      const product = await stock.product(out.code);
      if (!product) continue;
      const label = shoppingLabel(product);
      const open = (await lists.lists()).shopping.some((s) => !s.done && s.label.toLowerCase() === label.toLowerCase());
      if (open) continue;
      if (!out.autoShop) {
        propose.push({ code: out.code, label });
        continue;
      }
      const item = await lists.addShopping(label, by);
      await stock.attachShopping(out.movementId, item.id);
      added.push(label);
    }
    return { propose, added };
  }

  async function undoGroup(cook: string, entryId: string | null): Promise<CookUndo> {
    if (entryId) await menus.unmarkCooked(entryId);
    const result = await stock.undoCook(cook);
    // L'article ajouté d'office à la liste de courses part avec, s'il n'a pas encore été acheté.
    if (result.shoppingIds.length) {
      const { shopping } = await lists.lists();
      for (const id of result.shoppingIds) if (shopping.some((s) => s.id === id && !s.done)) await lists.removeShopping(id);
    }
    const kept: string[] = [];
    for (const code of new Set(result.kept)) kept.push((await stock.product(code))?.current.name ?? code);
    await menu.sync({ ownerId: null, via: 'tablet' });
    return { undone: result.undone.length, kept };
  }

  return {
    async proposal({ recipeId, entryId, people }) {
      if (entryId) {
        const found = await findEntry(entryId);
        if (!found) return refuse('unknown-meal');
        const recipe = await recipes.get(found.entry.recipeId);
        if (recipeId && found.entry.recipeId !== recipeId) return refuse('mismatch');
        const meal = mealOf(found.week, found.entry, recipe);
        return proposalFor(recipe, meal, recipe ? await mealsOf(recipe) : [meal], people, meal.title);
      }
      const recipe = recipeId ? await recipes.get(recipeId) : null;
      if (!recipe) return refuse('unknown-recipe');
      const meals = await mealsOf(recipe);
      const meal = entryId === null ? null : defaultMeal(meals, today());
      return proposalFor(recipe, meal, meals, people, recipe.ours.title);
    },

    async cook(recipeId, { entryId, people, replies }, by) {
      let found: { week: string; entry: MenuEntry } | null = null;
      let recipe: Recipe | null;
      if (entryId) {
        found = await findEntry(entryId);
        if (!found) return refuse('unknown-meal');
        if (recipeId && found.entry.recipeId !== recipeId) return refuse('mismatch');
        if (!cookWindow(found.week, today())) return refuse('closed');
        if (found.entry.cooked) return refuse('already');
        recipe = await recipes.get(found.entry.recipeId);
      } else {
        recipe = recipeId ? await recipes.get(recipeId) : null;
        if (!recipe) return refuse('unknown-recipe');
      }
      const title = recipe?.ours.title ?? found?.entry.title ?? '';
      const shown = clampPeople(people ?? found?.entry.people ?? recipe?.ours.servings ?? null);

      // Le serveur refait la proposition et vérifie chaque réponse : produit relié en stock, au plus le stock connu.
      const lines = recipe ? cookLines(recipe.ours, shown, await menu.cookContext()) : [];
      const changes: CookChange[] = [];
      const removed: string[] = [];
      const finishing = new Set<string>();
      const keys = new Set<string>();
      for (const reply of replies) {
        const line = lines.find((l) => l.key === reply.key);
        const option = line?.options.find((o) => (reply.container ? o.container?.id === reply.container : o.container === null && o.code === reply.code));
        if (!line || !option) return refuse('invalid', `Ligne inconnue ou plus en stock : ${reply.key}`);
        if (keys.has(reply.key)) return refuse('invalid', `Deux réponses pour ${line.name}`);
        if (!validAnswer(option, reply.answer)) return refuse('invalid', `Réponse impossible pour ${line.name}`);
        keys.add(reply.key);
        const effect = answerEffect(option, reply.answer);
        if (effect) changes.push(effect);
        const label = effectLabel(option, reply.answer);
        if (label) removed.push(label);
        if (finishesPack(reply.answer)) finishing.add(reply.key);
      }

      const cook = randomUUID();
      const returned: CookResult['returned'] = [];
      if (found) {
        // Coches de la semaine : « J'en ai déjà » retirée si le paquet est fini et qu'un autre repas en a encore
        // besoin ; « J'en ai assez » effacée par un paquet fini (le paquet qui suffisait est parti).
        const data = await menus.data();
        const week = found.week;
        const others = (data.weeks[week] ?? []).filter((e) => e.id !== found!.entry.id);
        const cleared = { have: [] as string[], checks: [] as string[] };
        for (const key of finishing) {
          if ((data.have[week] ?? []).includes(key)) {
            const needing: string[] = [];
            for (const other of others) {
              const r = await recipes.get(other.recipeId);
              if (r?.ours.ingredients.some((l) => l.key === key) && !eaten(other, key)) needing.push(r.ours.title);
            }
            if (needing.length) {
              cleared.have.push(key);
              returned.push({ name: lines.find((l) => l.key === key)?.name ?? key, sources: needing });
            }
          }
          if (data.checks[week]?.[key] === 'enough') cleared.checks.push(key);
        }
        const mark: CookedMark = { at: clock().toISOString(), by, cook, keys: [...keys], people: shown ?? found.entry.people, cleared };
        const marked = await menus.markCooked(found.entry.id, mark);
        if (marked === null) return refuse('unknown-meal');
        if (marked === 'already') return refuse('already');
      }

      let outs;
      try {
        outs = await stock.cook(cook, `Cuisiné : ${title}`, changes, by);
      } catch (err) {
        if (found) await menus.unmarkCooked(found.entry.id);
        throw err;
      }
      const shopping = await shoppingFor(outs, by);
      await menu.sync(by);
      return { cook, mealId: found?.entry.id ?? null, removed, ...shopping, returned };
    },

    async undo(cook) {
      const { weeks } = await menus.data();
      for (const [week, entries] of Object.entries(weeks)) {
        const entry = entries.find((e) => e.cooked?.cook === cook);
        if (!entry) continue;
        if (!cookWindow(week, today())) return refuse('closed');
        return undoGroup(cook, entry.id);
      }
      // Hors menu : seulement les mouvements du stock.
      const result = await undoGroup(cook, null);
      return result.undone === 0 && result.kept.length === 0 ? refuse('unknown-cook') : result;
    },

    async uncook(entryId) {
      const found = await findEntry(entryId);
      if (!found) return refuse('unknown-meal');
      if (!found.entry.cooked) return refuse('not-cooked');
      if (!cookWindow(found.week, today())) return refuse('closed');
      return undoGroup(found.entry.cooked.cook, entryId);
    },

    async reminder() {
      const { weeks } = await menus.data();
      const day = today();
      const count = openWeeks().reduce((sum, week) => sum + (weeks[week] ?? []).filter((e) => e.day !== null && e.day < day && !e.cooked).length, 0);
      return { count };
    },
  };
}
