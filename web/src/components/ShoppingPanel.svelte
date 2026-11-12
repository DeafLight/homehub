<script lang="ts">
  import { choiceFor, type DriveView, enseigneName, itemKey } from '../../../shared/drive.ts';
  import type { ShoppingItem } from '../../../shared/types.ts';
  import Icon from './Icon.svelte';
  import { revert } from '../lib/checkbox.ts';
  import { basketMark, choiceSummary } from '../lib/drive.ts';
  import { byAisle, itemAisle } from '../lib/menu.ts';

  // Liste de courses : saisie rapide, articles fréquents en un geste, à acheter (rangés par rayon) puis « dans le
  // panier » jusqu'à ce qu'on le vide. Les lignes du menu de la semaine portent le livre et leurs recettes ; elles
  // suivent le menu tant qu'elles ne sont pas cochées ; celles « à vérifier » (paquet peut-être entamé) le disent. Avec une enseigne de drive choisie, chaque article à
  // acheter dit le produit retenu chez elle (et ses paquets), et le bouton du chariot ouvre « Produit chez … ». Les
  // articles mis au panier en cours du drive (mode « Remplir le panier ») passent dans « Au drive » : ils ne sont pas
  // achetés pour autant ; « Reçu : tout cocher » les coche une fois le panier retiré (décocher reste possible).
  // Tailles réglables par le parent (--list-font, --list-row).
  type Props = {
    items: ShoppingItem[];
    frequent: string[];
    readOnly?: boolean;
    onAdd(label: string): Promise<void>;
    onToggle(item: ShoppingItem, done: boolean): void;
    onRemove(item: ShoppingItem): void;
    onClear(): void;
    /** Drive : produits retenus ; `onProduct` ouvre le choix du produit d'un article. */
    drive?: { view: DriveView; onProduct(item: ShoppingItem): void } | null;
  };
  let { items, frequent, readOnly = false, onAdd, onToggle, onRemove, onClear, drive = null }: Props = $props();
  const enseigne = $derived(drive?.view.settings.enseigne ?? null);

  const toBuy = $derived(items.filter((i) => !i.done));
  const markOf = (item: ShoppingItem) => (drive && enseigne ? basketMark(drive.view, item) : null);
  const atDrive = $derived(toBuy.filter((i) => markOf(i) !== null));
  const aisles = $derived(byAisle(toBuy.filter((i) => markOf(i) === null), itemAisle));
  const basket = $derived(items.filter((i) => i.done));

  let label = $state('');
  let busy = $state(false);

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const value = label.trim();
    if (!value || busy) return;
    busy = true;
    try {
      await onAdd(value);
      label = '';
    } catch {
      // affiché par le parent
    } finally {
      busy = false;
    }
  }
</script>

<div class="shopping">
  {#if !readOnly}
    <form class="add" onsubmit={add}>
      <input bind:value={label} maxlength="120" placeholder="Ajouter un article…" enterkeyhint="done" />
      <button type="submit" aria-label="Ajouter" disabled={!label.trim() || busy}><Icon name="plus" size={28} strokeWidth={2.4} /></button>
    </form>
  {/if}

  {#if frequent.length > 0 && !readOnly}
    <div class="frequent" aria-label="Souvent achetés">
      {#each frequent as name (name)}
        <button type="button" class="chip" onclick={() => onAdd(name).catch(() => {})}>+ {name}</button>
      {/each}
    </div>
  {/if}

  {#each aisles as group (group.aisle)}
    {#if aisles.length > 1}<h3 class="aisle">{group.aisle}</h3>{/if}
    <ul class="items">
      {#each group.items as item (item.id)}
        {@render row(item)}
      {/each}
    </ul>
  {:else}
    <p class="empty">{atDrive.length > 0 ? 'Rien d’autre à acheter.' : 'Rien à acheter.'}</p>
  {/each}

  {#if atDrive.length > 0}
    <div class="basket-head">
      <span><Icon name="cart" size={18} /> Au drive · {atDrive.length}</span>
      {#if !readOnly}<button type="button" class="clear" onclick={() => atDrive.forEach((i) => onToggle(i, true))}>Reçu : tout cocher</button>{/if}
    </div>
    <ul class="items">
      {#each atDrive as item (item.id)}
        {@render row(item)}
      {/each}
    </ul>
  {/if}

  {#if basket.length > 0}
    <div class="basket-head">
      <span>Dans le panier · {basket.length}</span>
      {#if !readOnly}<button type="button" class="clear" onclick={onClear}>Vider</button>{/if}
    </div>
    <ul class="items basket">
      {#each basket as item (item.id)}
        {@render row(item)}
      {/each}
    </ul>
  {/if}
</div>

{#snippet row(item: ShoppingItem)}
  <li>
    <label class:done={item.done}>
      <input type="checkbox" checked={item.done} disabled={readOnly} onchange={(e) => onToggle(item, revert(e.currentTarget, item.done))} />
      <span class="label">
        {item.label}
        {#if item.menu}
          <span class="menu" title="Menu de la semaine"><Icon name="book" size={18} /></span>
          <span class="sources">{item.menu.sources.join(', ')}</span>
          {#if item.menu.check && !item.done}<span class="check">À vérifier : paquet peut-être entamé</span>{/if}
        {/if}
        {#if enseigne && drive && !item.done}
          {@const mark = markOf(item)}
          {@const summary = mark ?? choiceSummary(item, choiceFor(drive.view.choices, itemKey(item), enseigne))}
          {#if summary}<span class="product" class:at-drive={mark !== null}><Icon name="cart" size={16} /> {summary}</span>{/if}
        {/if}
      </span>
    </label>
    {#if enseigne && drive && !item.done && !readOnly}
      <button type="button" class="remove" aria-label="Produit chez {enseigneName(enseigne)} : {item.label}" onclick={() => drive.onProduct(item)}>
        <Icon name="cart" size={22} />
      </button>
    {/if}
    {#if !readOnly}
      <button type="button" class="remove" aria-label="Retirer {item.label}" onclick={() => onRemove(item)}>
        <Icon name="close" size={22} />
      </button>
    {/if}
  </li>
{/snippet}

<style>
  .shopping {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
  }

  .add {
    display: flex;
    gap: 10px;
  }

  .add input {
    flex: 1;
    min-width: 0;
    min-height: var(--list-row, 58px);
    box-sizing: border-box;
    padding: 0 18px;
    border: 2px solid var(--surface-2);
    border-radius: 16px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, var(--list-font, 1.3rem));
    user-select: text;
  }

  .add input:focus {
    border-color: var(--rain);
    outline: none;
  }

  .add button {
    width: var(--list-row, 58px);
    flex-shrink: 0;
    border: 0;
    border-radius: 16px;
    background: var(--rain);
    color: var(--bg);
  }

  .add button:disabled {
    opacity: 0.4;
  }

  .frequent {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    min-height: 40px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
  }

  .chip:active {
    background: var(--border-strong);
  }

  .items {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--surface-2);
  }

  li:last-child {
    border-bottom: 0;
  }

  label {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 14px;
    min-width: 0;
    min-height: var(--list-row, 58px);
    font-size: var(--list-font, 1.3rem);
  }

  .label {
    overflow-wrap: anywhere;
  }

  .menu {
    display: inline-flex;
    vertical-align: -2px;
    margin-left: 4px;
    color: var(--rain-soft);
  }

  .sources {
    display: block;
    font-size: 0.8em;
    color: var(--fg-muted);
  }

  .product {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8em;
    color: var(--rain-soft);
  }

  .product :global(svg) {
    flex-shrink: 0;
  }

  .product.at-drive {
    color: var(--ok-fg);
  }

  .check {
    display: inline-block;
    margin-top: 2px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--warn-bg);
    color: var(--sun);
    font-size: 0.75em;
  }

  .aisle {
    margin: 4px 0 -8px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--fg-muted);
  }

  label.done {
    color: var(--fg-muted);
    text-decoration: line-through;
  }

  input[type='checkbox'] {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    margin: 0;
    accent-color: var(--ok);
  }

  .remove {
    display: grid;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--fg-muted);
  }

  .remove:active {
    background: var(--surface-2);
  }

  .empty {
    margin: 0;
    min-height: var(--list-row, 58px);
    font-size: var(--list-font, 1.3rem);
    color: var(--fg-muted);
    border: 0;
  }

  .basket-head span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .basket-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 6px;
    font-size: 0.9rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .clear {
    min-height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
  }
</style>
