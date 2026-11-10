<script lang="ts">
  import type { StockEntry } from '../../../../shared/types.ts';
  import { filterStock, lastMarksLine, productSubtitle, type StockFilter, stockCounts } from '../../lib/stock.ts';
  import Icon from '../Icon.svelte';

  // Inventaire de la page Stock : filtres (en stock, épuisés, tout), puis un produit par ligne avec sa quantité à
  // corriger à la main. Sur le téléphone, une ligne compacte et sans date ni auteur (dans la fiche du produit).
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
  };
  let { items, filter = $bindable(), search, phone, readOnly, busy, now, nameOf, onOpen, onPlus, onMinus, onExhaust }: Props = $props();

  const counts = $derived(stockCounts(items));
  const shown = $derived(filterStock(items, filter, search));
  const FILTERS: { filter: StockFilter; label: string }[] = [
    { filter: 'in', label: 'En stock' },
    { filter: 'out', label: 'Épuisés' },
    { filter: 'all', label: 'Tout' },
  ];
</script>

<div class="filters" class:phone role="tablist" aria-label="Produits affichés">
  {#each FILTERS as f (f.filter)}
    <button type="button" role="tab" aria-selected={filter === f.filter} class:on={filter === f.filter} onclick={() => (filter = f.filter)}>{f.label} · {counts[f.filter]}</button>
  {/each}
</div>
<ul class="list" class:phone>
  {#each shown as entry (entry.product.code)}
    {@const product = entry.product}
    {@const marks = phone ? '' : lastMarksLine(entry, now, nameOf)}
    <li class:empty={entry.quantity === 0}>
      <button type="button" class="name" onclick={() => onOpen(entry)}>
        <strong>{product.current.name}{#if product.conflict}<span class="flag" title="La base dit autre chose">!</span>{/if}</strong>
        <span>{productSubtitle(product)}</span>
        {#if marks}<span class="marks">{marks}</span>{/if}
      </button>
      {#if !readOnly}
        <span class="qty">
          <button type="button" class="round" aria-label="Un de moins" disabled={busy || entry.quantity === 0} onclick={() => onMinus(entry)}><Icon name="minus" size={22} /></button>
          <span class="count">{entry.quantity}</span>
          <button type="button" class="round" aria-label="Un de plus" disabled={busy} onclick={() => onPlus(entry)}><Icon name="plus" size={22} /></button>
        </span>
        {#if entry.quantity > 1}
          <button type="button" class="btn small" disabled={busy} onclick={() => onExhaust(entry)}>Épuisé</button>
        {/if}
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
      {:else}
        Aucun produit ici.
      {/if}
    </li>
  {/each}
</ul>

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

  .list.phone .round {
    width: 40px;
    height: 40px;
  }
</style>
