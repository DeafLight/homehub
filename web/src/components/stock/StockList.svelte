<script lang="ts">
  import type { LotView, StockEntry } from '../../../../shared/types.ts';
  import { estimateLabel } from '../../../../shared/cook.ts';
  import { canExhaust, lastMarksLine, productSubtitle, type StockFilter, stockCounts, stockRows, thrownText } from '../../lib/stock.ts';
  import Icon from '../Icon.svelte';
  import ExpiryPill from './ExpiryPill.svelte';

  // Inventaire de la page Stock : filtres (en stock, à consommer, épuisés, tout), puis un produit par ligne avec sa
  // quantité à corriger à la main et « Épuisé » (tout sortir, même s'il n'en reste qu'un). La pastille de date (le
  // lot le plus urgent) se touche pour corriger la date. « À consommer » : une ligne par lot qui arrive à date, la plus
  // proche d'abord ; sur un lot passé, « Jeté » (ce lot-là) et « Encore bon » (l'alerte se tait ; demandé deux fois
  // pour une DLC). Sur le téléphone, une ligne compacte et sans auteur (dans la fiche du produit).
  type Props = {
    items: StockEntry[];
    filter: StockFilter;
    search: string;
    phone: boolean;
    readOnly: boolean;
    busy: boolean;
    now: Date;
    nameOf: (ownerId: string | null) => string | null;
    onOpen: (entry: StockEntry) => void;
    onPlus: (entry: StockEntry) => void;
    onMinus: (entry: StockEntry) => void;
    onExhaust: (entry: StockEntry) => void;
    /** Aujourd'hui (AAAA-MM-JJ). */
    today: string;
    /** Produits jetés périmés ce mois-ci (null : pas encore lu). */
    thrown: number | null;
    onDate: (entry: StockEntry, lot: LotView) => void;
    onThrow: (entry: StockEntry, lot: LotView) => void;
    onKeep: (entry: StockEntry, lot: LotView) => void;
  };
  let { items, filter = $bindable(), search, phone, readOnly, busy, now, nameOf, onOpen, onPlus, onMinus, onExhaust, today, thrown, onDate, onThrow, onKeep }: Props = $props();

  const counts = $derived(stockCounts(items));
  const rows = $derived(stockRows(items, filter, search));
  const FILTERS: { filter: StockFilter; label: string }[] = [
    { filter: 'in', label: 'En stock' },
    { filter: 'expiring', label: 'À consommer' },
    { filter: 'out', label: 'Épuisés' },
    { filter: 'all', label: 'Tout' },
  ];
  /** « Encore bon » touché une fois sur une DLC passée : on redemande. */
  let confirmKeep = $state<string | null>(null);

  function keep(entry: StockEntry, lot: LotView) {
    if (lot.dateKind === 'dlc' && !lot.estimated && confirmKeep !== lot.id) {
      confirmKeep = lot.id;
      return;
    }
    confirmKeep = null;
    onKeep(entry, lot);
  }
</script>

<div class="filters" class:phone role="tablist" aria-label="Produits affichés">
  {#each FILTERS as f (f.filter)}
    {#if f.filter !== 'expiring' || counts.expiring > 0 || filter === 'expiring'}
      <button type="button" role="tab" aria-selected={filter === f.filter} class:on={filter === f.filter} class:warn={f.filter === 'expiring'} onclick={() => (filter = f.filter)}
        >{f.label} · {counts[f.filter]}</button
      >
    {/if}
  {/each}
</div>
<ul class="list" class:phone>
  {#each rows as { entry, lot, part } (`${entry.product.code}-${filter === 'expiring' ? lot?.id : ''}`)}
    {@const product = entry.product}
    {@const marks = phone ? '' : lastMarksLine(entry, now, nameOf)}
    {@const passed = filter === 'expiring' && lot?.level === 'passed'}
    <li class:empty={entry.quantity === 0}>
      <button type="button" class="name" onclick={() => onOpen(entry)}>
        <strong>{product.current.name}{#if part}<span class="part"> · {part}</span>{/if}{#if product.conflict}<span class="flag" title="La base dit autre chose">!</span>{/if}</strong>
        <span>{productSubtitle(product)}{entry.opened !== null && entry.quantity > 0 ? ` · entamé, il en reste ${estimateLabel(entry.opened)}` : ''}</span>
        {#if marks}<span class="marks">{marks}</span>{/if}
      </button>
      {#if lot?.due}
        <span class="date"><ExpiryPill {lot} {today} short={phone} onclick={readOnly ? undefined : () => onDate(entry, lot)} /></span>
      {/if}
      {#if passed && lot && !readOnly}
        <span class="lot-actions">
          <button type="button" class="btn small" disabled={busy} onclick={() => onThrow(entry, lot)}>Jeté</button>
          <button type="button" class="btn small" class:confirm={confirmKeep === lot.id} disabled={busy} onclick={() => keep(entry, lot)}>
            {confirmKeep === lot.id ? 'Sûr ? Encore bon' : 'Encore bon'}
          </button>
        </span>
      {:else if !readOnly}
        <span class="qty">
          <button type="button" class="round" aria-label="Un de moins" disabled={busy || entry.quantity === 0} onclick={() => onMinus(entry)}><Icon name="minus" size={22} /></button>
          <span class="count">{entry.quantity}</span>
          <button type="button" class="round" aria-label="Un de plus" disabled={busy} onclick={() => onPlus(entry)}><Icon name="plus" size={22} /></button>
        </span>
        <!-- Sur chaque produit, même seul (le stock tombe à 0) ; grisé une fois épuisé. -->
        <button type="button" class="btn small" disabled={busy || !canExhaust(entry)} onclick={() => onExhaust(entry)}>Épuisé</button>
      {:else}
        <span class="count">{entry.quantity}</span>
      {/if}
    </li>
  {:else}
    <li class="none">
      {#if items.length === 0}
        Rien pour l’instant : scanne les courses en les rangeant (« Ranger les courses »).
      {:else if search}
        Aucun produit ne correspond.
      {:else if filter === 'expiring'}
        Rien n’arrive à date.
      {:else}
        Aucun produit ici.
      {/if}
    </li>
  {/each}
</ul>
{#if filter === 'expiring' && thrown !== null}
  <p class="thrown">{thrownText(thrown)}</p>
{/if}

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .filters button {
    min-height: 48px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-small);
  }

  .filters button.on {
    background: var(--rain);
    color: var(--bg);
    font-weight: 600;
  }

  .filters button.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }

  .filters button.warn.on {
    background: var(--warn);
    color: var(--bg);
  }

  .part {
    color: var(--fg-muted);
    font-size: var(--text-small);
    font-weight: 400;
  }

  .date {
    display: flex;
    flex: none;
  }

  .lot-actions {
    display: flex;
    gap: var(--space-1);
  }

  .lot-actions .confirm {
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  .thrown {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-small);
  }

  .list {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  /* flex: none : dans la liste qui défile, une ligne garde sa hauteur au lieu d'être écrasée et de laisser déborder son texte. */
  .list li {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    min-height: 72px;
    border-bottom: 1px solid var(--surface-2);
  }

  .list li.empty .name strong {
    color: var(--fg-muted);
  }

  .list li.none {
    min-height: 0;
    padding: var(--space-2) 0;
    border: 0;
    color: var(--fg-muted);
  }

  .name {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 8px 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }

  .name strong {
    overflow: hidden;
    font-size: var(--text-body);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .name span {
    overflow: hidden;
    color: var(--fg-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Dernière entrée et sortie : sur deux lignes s'il le faut, jamais coupée. */
  .name .marks {
    font-size: var(--text-small);
    white-space: normal;
  }

  .flag {
    display: inline-grid;
    width: 22px;
    height: 22px;
    margin-left: 8px;
    place-items: center;
    border-radius: 50%;
    background: var(--warn);
    color: var(--bg);
    font-size: 0.9rem;
  }

  .qty {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .round {
    display: grid;
    width: 48px;
    height: 48px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
  }

  .round:disabled {
    opacity: 0.4;
  }

  .count {
    min-width: 2ch;
    font-size: var(--text-title);
    font-weight: 600;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* Téléphone : toute la page défile ; les boutons d'un produit sous son nom. */
  .filters.phone button {
    min-height: 44px;
    padding: 0 12px;
  }

  .list.phone {
    flex: none;
    overflow: visible;
  }

  /* Une ligne compacte, pour voir plusieurs produits d'un coup : le texte à gauche, les boutons empilés à droite. */
  .list.phone li:not(.none) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-1);
    row-gap: 6px;
    padding: 8px 0;
  }

  .list.phone .name {
    grid-row: 1 / span 2;
    padding: 0;
  }

  .list.phone .name strong,
  .list.phone .name span {
    white-space: normal;
  }

  .list.phone li > .btn {
    justify-self: end;
  }

  .list.phone li > .count {
    grid-row: 1 / span 2;
  }

  .list.phone .date {
    grid-column: 1;
  }

  .list.phone .lot-actions {
    grid-column: 2;
    grid-row: 1 / span 2;
    flex-direction: column;
  }

  .list.phone .round {
    width: 40px;
    height: 40px;
  }
</style>
