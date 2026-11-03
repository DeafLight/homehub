<script lang="ts">
  import type { ShoppingItem } from '../../../shared/types.ts';
  import Icon from './Icon.svelte';

  // Liste de courses : saisie rapide, articles fréquents en un geste, à acheter puis « dans le panier » jusqu'à
  // ce qu'on le vide. Tailles réglables par le parent (--list-font, --list-row) : tablette ou téléphone.
  type Props = {
    items: ShoppingItem[];
    frequent: string[];
    readOnly?: boolean;
    /** Saisie en haut (tablette) ; sur le téléphone, l'ajout passe par le bouton « + ». */
    showInput?: boolean;
    onAdd(label: string): Promise<void>;
    onToggle(item: ShoppingItem, done: boolean): void;
    onRemove(item: ShoppingItem): void;
    onClear(): void;
  };
  let { items, frequent, readOnly = false, showInput = true, onAdd, onToggle, onRemove, onClear }: Props = $props();

  const toBuy = $derived(items.filter((i) => !i.done));
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
  {#if showInput && !readOnly}
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

  <ul class="items">
    {#each toBuy as item (item.id)}
      {@render row(item)}
    {:else}
      <li class="empty">Rien à acheter.</li>
    {/each}
  </ul>

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
      <input type="checkbox" checked={item.done} disabled={readOnly} onchange={(e) => onToggle(item, e.currentTarget.checked)} />
      <span class="label">{item.label}</span>
    </label>
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
    min-height: var(--list-row, 58px);
    font-size: var(--list-font, 1.3rem);
    color: var(--fg-muted);
    border: 0;
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
