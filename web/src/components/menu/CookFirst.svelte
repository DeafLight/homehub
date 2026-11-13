<script lang="ts">
  import { relativeDay } from '../../../../shared/expiry.ts';
  import type { CookFirst } from '../../../../shared/expiry.ts';

  // « À cuisiner d'abord » (menu de la semaine) : recettes du carnet qui utilisent un ingrédient relié à un produit
  // qui arrive à date, la plus utile d'abord ; « Ce soir », « Demain » ou « Ajouter » (sans jour) la mettent au menu.
  // Rien n'est ajouté d'office.
  type Props = {
    items: CookFirst[];
    today: string;
    editable: boolean;
    busy: boolean;
    /** Jours proposés (dans la semaine affichée) : ce soir, demain ; null si hors de la semaine. */
    tonight: string | null;
    tomorrow: string | null;
    onAdd: (recipeId: string, day: string | null) => void;
  };
  let { items, today, editable, busy, tonight, tomorrow, onAdd }: Props = $props();
</script>

<section class="cook-first" aria-label="À cuisiner d’abord">
  <h3 class="card-label">À cuisiner d’abord</h3>
  <ul>
    {#each items as item (item.recipeId)}
      <li>
        <span class="what">
          <strong>{item.title}</strong>
          <span class="uses">
            utilise
            {#each item.uses as use, i (use.key)}{i > 0 ? ', ' : ' '}<span class="use">{use.name} ({relativeDay(use.due, today)}{use.estimated ? ', estimé' : ''})</span>{/each}
          </span>
        </span>
        {#if editable}
          <span class="actions">
            {#if tonight}<button type="button" class="btn small primary" disabled={busy} onclick={() => onAdd(item.recipeId, tonight)}>Ce soir</button>{/if}
            {#if tomorrow}<button type="button" class="btn small" disabled={busy} onclick={() => onAdd(item.recipeId, tomorrow)}>Demain</button>{/if}
            <button type="button" class="btn small" disabled={busy} onclick={() => onAdd(item.recipeId, null)}>Ajouter</button>
          </span>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .cook-first {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }

  h3 {
    margin: 0;
    color: var(--warn);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .uses {
    color: var(--fg-muted);
    font-size: var(--text-small);
  }

  .use {
    color: var(--warn);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
