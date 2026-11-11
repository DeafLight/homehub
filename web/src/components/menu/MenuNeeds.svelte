<script lang="ts">
  import type { PlanLine } from '../../../../shared/menu.ts';
  import { lineAmount, lineSources, lineStatus, planGroups } from '../../lib/menu.ts';

  // Courses du menu : ce qu'il reste à acheter, par rayon, avec les recettes d'où vient chaque ligne et ce qu'on en a
  // déjà (stock, déjà acheté) ; « J'en ai déjà » la retire de la liste pour la semaine. Puis ce qui n'est pas à
  // acheter (placards, en stock, coché, déjà sur la liste à la main). Ces lignes sont sur la liste de courses.
  type Props = {
    plan: PlanLine[];
    editable: boolean;
    /** Texte quand le menu est vide. */
    empty: string;
    busy: boolean;
    onHave: (line: PlanLine, have: boolean) => void;
  };
  let { plan, editable, empty, busy, onHave }: Props = $props();

  const groups = $derived(planGroups(plan));
</script>

{#if plan.length === 0}
  <p class="muted">{empty}</p>
{:else}
  <div class="needs">
    {#each groups.toBuy as group (group.aisle)}
      <h3>{group.aisle}</h3>
      <ul>
        {#each group.items as line (line.key)}
          {@const status = lineStatus(line)}
          <li>
            <div class="what">
              <span class="name">{line.name}{#if line.optional}{' '}<span class="muted">(facultatif)</span>{/if}</span>
              <span class="amount">{lineAmount(line)}</span>
              <span class="sources">{lineSources(line)}</span>
              {#if status}<span class="chip" class:warn={line.stock?.enough === null}>{status}</span>{/if}
            </div>
            {#if editable}
              <button type="button" class="btn small" disabled={busy} onclick={() => onHave(line, true)}>J’en ai déjà</button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">Rien à acheter pour ce menu.</p>
    {/each}

    {#if groups.covered.length > 0}
      <h3>Déjà à la maison</h3>
      <ul class="covered">
        {#each groups.covered as line (line.key)}
          <li>
            <div class="what">
              <span class="name">{line.name}</span>
              <span class="amount">{lineAmount(line)}</span>
              <span class="chip ok">{lineStatus(line)}</span>
            </div>
            {#if editable && line.status === 'have'}
              <button type="button" class="btn small" disabled={busy} onclick={() => onHave(line, false)}>À acheter</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .needs {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  h3 {
    margin: var(--space-1) 0 0;
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--fg-muted);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 56px;
    padding: 6px 0;
    border-bottom: 1px solid var(--surface-2);
  }

  li:last-child {
    border-bottom: 0;
  }

  .what {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    min-width: 0;
  }

  .name {
    font-size: var(--text-body);
    font-weight: 600;
  }

  .amount {
    font-size: var(--text-body);
    color: var(--rain-soft);
    font-variant-numeric: tabular-nums;
  }

  .sources {
    flex-basis: 100%;
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .chip {
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
    font-size: var(--text-small);
  }

  .chip.ok {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }

  .chip.warn {
    background: var(--warn-bg);
    color: var(--sun);
  }

  .covered .name {
    font-weight: 400;
    color: var(--fg-soft);
  }

  .covered .amount {
    color: var(--fg-muted);
  }

  .muted {
    color: var(--fg-muted);
  }
</style>
