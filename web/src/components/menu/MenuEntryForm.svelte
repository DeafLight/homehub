<script lang="ts">
  import { untrack } from 'svelte';
  import { MENU_LIMITS, type MenuViewEntry, weekDays } from '../../../../shared/menu.ts';
  import type { RecipeSummary } from '../../../../shared/recipes.ts';
  import { dayLabel } from '../../lib/menu.ts';
  import { searchRecipes } from '../../lib/recipes.ts';
  import Icon from '../Icon.svelte';

  // Ajouter une recette du carnet au menu (choisir la recette, puis personnes et jour), ou régler une recette déjà au
  // menu (`entry`) : personnes, jour, ouvrir la recette, la retirer. Une recette peut revenir plusieurs fois.
  type Choice = { recipeId: string; people: number; day: string | null };
  type Props = {
    week: string;
    recipes?: RecipeSummary[];
    entry?: MenuViewEntry;
    editable: boolean;
    busy: boolean;
    onSave: (choice: Choice) => void;
    onRemove?: () => void;
    onOpenRecipe?: () => void;
    onCancel: () => void;
  };
  let { week, recipes = [], entry, editable, busy, onSave, onRemove, onOpenRecipe, onCancel }: Props = $props();

  let search = $state('');
  let picked = $state<RecipeSummary | null>(null);
  let people = $state(untrack(() => entry?.people ?? 4));
  let day = $state<string | null>(untrack(() => entry?.day ?? null));
  const unit = $derived(entry?.servingsUnit ?? picked?.servingsUnit ?? 'personnes');
  const found = $derived(searchRecipes(recipes, search));

  function pick(recipe: RecipeSummary) {
    picked = recipe;
    people = Math.min(recipe.servings ?? 4, MENU_LIMITS.people);
  }
</script>

<div class="form">
  {#if !entry && !picked}
    <h2>Ajouter au menu</h2>
    <input type="search" bind:value={search} placeholder="Chercher une recette" aria-label="Chercher une recette" />
    <ul class="recipes">
      {#each found as recipe (recipe.id)}
        <li>
          <button type="button" onclick={() => pick(recipe)}>
            <span>{recipe.title}</span>
            {#if recipe.servings}<span class="muted">{recipe.servings} {recipe.servingsUnit ?? 'pers.'}</span>{/if}
          </button>
        </li>
      {:else}
        <li class="muted">{recipes.length === 0 ? 'Le carnet est vide : importe d’abord une recette.' : 'Aucune recette ne correspond.'}</li>
      {/each}
    </ul>
    <div class="actions"><button type="button" class="btn" onclick={onCancel}>Annuler</button></div>
  {:else}
    <h2>{entry?.title ?? picked?.title}</h2>
    {#if editable && !entry?.missing}
      <div class="row">
        <span class="label">Pour</span>
        <button type="button" class="round" aria-label="Moins" disabled={people <= 1} onclick={() => (people -= 1)}><Icon name="minus" size={22} /></button>
        <strong class="count">{people}</strong>
        <button type="button" class="round" aria-label="Plus" disabled={people >= MENU_LIMITS.people} onclick={() => (people += 1)}><Icon name="plus" size={22} /></button>
        <span>{unit}</span>
      </div>
      <div class="days" role="group" aria-label="Jour">
        <button type="button" class:on={day === null} onclick={() => (day = null)}>Dans la semaine</button>
        {#each weekDays(week) as d (d)}
          <button type="button" class:on={day === d} onclick={() => (day = d)}>{dayLabel(d)}</button>
        {/each}
      </div>
    {/if}
    <div class="actions">
      {#if entry && onOpenRecipe && !entry.missing}<button type="button" class="btn" onclick={onOpenRecipe}><Icon name="book" size={22} /> Voir la recette</button>{/if}
      {#if entry && editable && onRemove}<button type="button" class="btn" disabled={busy} onclick={onRemove}><Icon name="trash" size={22} /> Retirer</button>{/if}
      <span class="spacer"></span>
      <button type="button" class="btn" onclick={onCancel}>{editable ? 'Annuler' : 'Fermer'}</button>
      {#if editable && !entry?.missing}
        <button type="button" class="btn primary" disabled={busy} onclick={() => onSave({ recipeId: entry?.recipeId ?? picked!.id, people, day })}>{entry ? 'Enregistrer' : 'Ajouter'}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  input[type='search'] {
    min-height: 52px;
    padding: 0 20px;
    border: 2px solid var(--surface-2);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, var(--text-body));
  }

  .recipes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 50vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .recipes button {
    display: flex;
    justify-content: space-between;
    gap: var(--space-1);
    width: 100%;
    min-height: 52px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-body);
    text-align: left;
    align-items: center;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-body);
  }

  .label {
    color: var(--fg-muted);
  }

  .count {
    min-width: 36px;
    font-size: var(--text-title);
    text-align: center;
  }

  .round {
    display: grid;
    width: 52px;
    height: 52px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
  }

  .round:disabled {
    opacity: 0.4;
  }

  .days {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .days button {
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
    font: inherit;
    font-size: var(--text-small);
    font-weight: 600;
  }

  .days button.on {
    background: var(--rain);
    color: var(--bg);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .spacer {
    flex: 1;
  }

  .muted {
    color: var(--fg-muted);
  }
</style>
