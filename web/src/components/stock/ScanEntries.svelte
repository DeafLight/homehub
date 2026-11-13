<script lang="ts">
  import type { Product } from '../../../../shared/types.ts';
  import { formatTime } from '../../lib/format.ts';
  import { entryDateChip, entrySubtitle, type ScanEntry } from '../../lib/scan.ts';
  import Icon from '../Icon.svelte';

  // Journal du passage au scanner : une ligne par mouvement (le plus récent en tête), avec quand et par qui, et de
  // quoi corriger : fiche du produit, « C'était une recharge », annuler. Une entrée porte sa pastille de date
  // (« Date ? », sa date, « pas de date ») : la toucher ouvre le pavé, le scan continue sans elle.
  type Props = {
    entries: ScanEntry[];
    busy: boolean;
    nameOf: (ownerId: string | null) => string | null;
    onSheet: (product: Product) => void;
    onRefill: (entry: ScanEntry) => void;
    onDate: (entry: ScanEntry) => void;
    onUndo: (entry: ScanEntry) => void;
  };
  let { entries, busy, nameOf, onSheet, onRefill, onDate, onUndo }: Props = $props();
</script>

<ul class="entries">
  {#each entries as entry (entry.id)}
    {@const chip = entryDateChip(entry)}
    <li class:undone={entry.undone}>
      <span class="kind {entry.kind}"><Icon name={entry.kind === 'in' ? 'cart' : entry.kind === 'out' ? 'trash' : 'jar'} size={22} /></span>
      <span class="entry-text">
        <strong>{entry.title}</strong>
        <span>{entrySubtitle(entry)}</span>
        {#if entry.mark}<span class="when">{formatTime(new Date(entry.mark.at))} · {nameOf(entry.mark.by.ownerId) ?? 'anonyme'}</span>{/if}
      </span>
      {#if chip}
        <button type="button" class="date-chip {chip.tone}" disabled={busy} onclick={() => onDate(entry)}>{chip.label}</button>
      {/if}
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
    grid-template-columns: auto minmax(0, 1fr) auto;
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
    grid-column: 2 / span 2;
    gap: 6px;
  }

  .date-chip {
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
    font: inherit;
    font-size: var(--text-small);
    font-weight: 600;
    white-space: nowrap;
  }

  .date-chip.ask {
    border: 1px dashed var(--rain-soft);
    background: var(--rain-bg);
    color: var(--rain-soft);
  }

  .date-chip.muted {
    border-color: var(--border-strong);
    background: none;
    color: var(--fg-muted);
    font-weight: 400;
  }

  .date-chip.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }

  .date-chip.bad {
    background: var(--danger-bg);
    color: var(--danger-fg);
  }
</style>
