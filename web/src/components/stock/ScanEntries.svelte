<script lang="ts">
  import type { Product } from '../../../../shared/types.ts';
  import { formatTime } from '../../lib/format.ts';
  import { entryActions, entryDateChip, entrySubtitle, type ScanEntry } from '../../lib/scan.ts';
  import Icon from '../Icon.svelte';

  // Journal du passage au scanner : une ligne par mouvement (le plus récent en tête), avec quand et par qui, et de
  // quoi corriger : fiche du produit, « C'était une recharge », annuler. Une entrée porte sa pastille de date
  // (« Date ? », sa date, « pas de date ») : la toucher ouvre le pavé, le scan continue sans elle. `compact`
  // (téléphone) : deux lignes courtes par mouvement (nom, puis « Rangé · 5 en stock »), les corrections dépliées sous la ligne par le bouton ⋮.
  type Props = {
    entries: ScanEntry[];
    busy: boolean;
    nameOf: (ownerId: string | null) => string | null;
    onSheet: (product: Product) => void;
    onRefill: (entry: ScanEntry) => void;
    onDate: (entry: ScanEntry) => void;
    onUndo: (entry: ScanEntry) => void;
    compact?: boolean;
  };
  let { entries, busy, nameOf, onSheet, onRefill, onDate, onUndo, compact = false }: Props = $props();
  /** Téléphone : ligne dont les corrections sont dépliées. */
  let opened = $state<string | null>(null);
</script>

<ul class="entries" class:compact>
  {#each entries as entry (entry.id)}
    {@const chip = entryDateChip(entry)}
    {@const actions = entryActions(entry)}
    {@const open = !compact || opened === entry.id}
    <li class:undone={entry.undone} class:has-more={compact && actions.length > 0}>
      <span class="kind {entry.kind}"><Icon name={entry.kind === 'in' ? 'cart' : entry.kind === 'out' ? 'trash' : 'jar'} size={22} /></span>
      <span class="entry-text">
        <strong>{entry.title}</strong>
        <span>{compact ? entry.line : entrySubtitle(entry)}</span>
        <!-- Téléphone : pas d'heure ni de nom, le passage est celui de la personne du téléphone, tout juste fait. -->
        {#if entry.mark && !compact}<span class="when">{formatTime(new Date(entry.mark.at))} · {nameOf(entry.mark.by.ownerId) ?? 'anonyme'}</span>{/if}
      </span>
      {#if chip}
        {#if compact && chip.tone === 'muted'}
          <!-- Téléphone : produit sans date d'habitude, un simple calendrier pour lui en donner une quand même. -->
          <button type="button" class="date-chip muted icon" aria-label="Ajouter une date" disabled={busy} onclick={() => onDate(entry)}><Icon name="calendar" size={20} /></button>
        {:else}
          <button type="button" class="date-chip {chip.tone}" disabled={busy} onclick={() => onDate(entry)}>{chip.label}</button>
        {/if}
      {/if}
      {#if compact && actions.length}
        <button type="button" class="more" aria-label="Corriger" aria-expanded={open} onclick={() => (opened = open ? null : entry.id)}><Icon name="more" size={22} /></button>
      {/if}
      {#if open && actions.length}
        <span class="entry-actions">
          {#if actions.includes('sheet')}
            <button type="button" class="btn small" onclick={() => entry.product && onSheet(entry.product)}>Ce n’est pas ça ?</button>
          {/if}
          {#if actions.includes('refill')}
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

  /* Téléphone : pastille de date et bouton ⋮ au bout de la ligne, texte sur une ligne chacun. */
  .entries li.has-more {
    grid-template-columns: auto minmax(0, 1fr) auto auto;
  }

  .compact li {
    gap: 6px 10px;
    padding: 8px 6px 8px 10px;
  }

  .compact .kind {
    width: 34px;
    height: 34px;
  }

  .compact .entry-text span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .compact .entry-actions {
    grid-column: 1 / -1;
  }

  .compact .date-chip {
    padding: 0 10px;
  }

  .date-chip.icon {
    display: grid;
    width: 40px;
    padding: 0;
    place-items: center;
  }

  .more {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--fg-muted);
  }

  .more[aria-expanded='true'] {
    background: var(--surface-2);
    color: var(--fg);
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
