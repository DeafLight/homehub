<script lang="ts">
  import type { RecipeSummary } from '../../../../shared/recipes.ts';
  import { formatMinutes } from '../../../../shared/recipes.ts';
  import { servingsText } from '../../lib/recipes.ts';
  import Icon from '../Icon.svelte';

  // Cartes du carnet : photo (ou pictogramme), titre, temps, portions, site d'origine, pastille Cookeo. En grille sur
  // la tablette, en liste sur le téléphone. Affichage seul : `onOpen` ouvre la fiche.
  type Props = { recipes: RecipeSummary[]; photoUrl: (id: string) => string; phone?: boolean; onOpen: (recipe: RecipeSummary) => void };
  let { recipes, photoUrl, phone = false, onOpen }: Props = $props();
</script>

<ul class="cards" class:phone>
  {#each recipes as recipe (recipe.id)}
    {@const details = [recipe.totalMinutes ? formatMinutes(recipe.totalMinutes) : null, servingsText(recipe.servings, recipe.servingsUnit), recipe.site ?? 'Saisie à la main'].filter(Boolean)}
    <li>
      <button type="button" onclick={() => onOpen(recipe)}>
        <span class="photo">
          {#if recipe.photo}
            <img src={photoUrl(recipe.id)} alt="" loading="lazy" />
          {:else}
            <Icon name="chef" size={phone ? 30 : 44} color="var(--fg-muted)" />
          {/if}
        </span>
        <span class="text">
          <span class="title">{recipe.title}</span>
          <span class="details">
            {#if recipe.appliance === 'cookeo'}<span class="chip">Cookeo</span>{/if}
            {details.join(' · ')}
          </span>
        </span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    text-align: left;
    overflow: hidden;
    cursor: pointer;
  }

  button:active {
    background: var(--surface-2);
  }

  .photo {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    height: 150px;
    overflow: hidden;
    background: var(--surface-2);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-2);
  }

  .title {
    font-size: var(--text-body);
    font-weight: 600;
    line-height: 1.25;
  }

  .details {
    color: var(--fg-muted);
    font-size: 1rem;
  }

  .chip {
    display: inline-block;
    margin-right: 6px;
    padding: 1px 10px;
    border-radius: 999px;
    background: var(--warn-bg);
    color: var(--sun);
    font-weight: 600;
  }

  .phone {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .phone button {
    flex-direction: row;
    align-items: center;
    border-radius: 18px;
  }

  .phone .photo {
    flex-shrink: 0;
    width: 84px;
    height: 84px;
  }

  .phone .text {
    padding: 10px 14px;
  }

  .phone .title {
    font-size: 1.1rem;
  }

  .phone .details {
    font-size: 0.95rem;
  }
</style>
