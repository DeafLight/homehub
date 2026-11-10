<script lang="ts">
  import type { Product } from '../../../../shared/types.ts';
  import { formatTime } from '../../lib/format.ts';
  import { entrySubtitle, type ScanEntry } from '../../lib/scan.ts';
  import Icon from '../Icon.svelte';

  // Journal du passage au scanner : une ligne par mouvement (le plus récent en tête), avec quand et par qui, et de
  // quoi corriger : fiche du produit, « C'était une recharge », annuler.
  type Props = {
    entries: ScanEntry[];
    busy: boolean;
    nameOf: (ownerId: string | null) => string | null;
    onSheet: (product: Product) => void;
    onRefill: (entry: ScanEntry) => void;
    onUndo: (entry: ScanEntry) => void;
  };
  let { entries, busy, nameOf, onSheet, onRefill, onUndo }: Props = $props();
</script>

<ul class="entries">
  {#each entries as entry (entry.id)}
    <li class:undone={entry.undone}>
      <span class="kind {entry.kind}"><Icon name={entry.kind === 'in' ? 'cart' : entry.kind === 'out' ? 'trash' : 'jar'} size={22} /></span>
      <span class="entry-text">
        <strong>{entry.title}</strong>
        <span>{entrySubtitle(entry)}</span>
        {#if entry.mark}<span class="when">{formatTime(new Date(entry.mark.at))} · {nameOf(entry.mark.by.ownerId) ?? 'anonyme'}</span>{/if}
      </span>
      {#if !entry.undone}
        <span class="entry-actions">
          {#if entry.product}
            <button type="button" class="btn small" onclick={() => entry.product && onSheet(entry.product)}>Ce n’est pas ça ?</button>
          {/if}
          {#if entry.kind === 'out' && entry.product}
            <button type="button" class="btn small" onclick={() => onRefill(entry)}>Recharge ?</button>
          {/if}
          <button type="button" class="btn small" aria-label="Annuler" disabled={busy} onclick={() => onUndo(entry)}><Icon name="undo" size={20} /> Annuler</button>
        </span>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .entries {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .entries li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 6px var(--space-2);
    padding: 12px var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .entries li.undone {
    opacity: 0.5;
  }

  .kind {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 50%;
    background: var(--rain-bg);
    color: var(--rain-soft);
  }

  .kind.out {
    background: var(--warn-bg);
    color: var(--warn);
  }

  .kind.refill,
  .kind.empty {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }

  .entry-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .entry-text strong {
    overflow: hidden;
    font-size: var(--text-body);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .entry-text span {
    color: var(--fg-muted);
  }

  .entry-text .when {
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }

  .entry-actions {
    display: flex;
    flex-wrap: wrap;
    grid-column: 2;
    gap: 6px;
  }
</style>
