<script lang="ts">
  import type { MenuStockProduct, StockLink } from '../../../../shared/menu.ts';
  import { ingredientKey, type Unit } from '../../../../shared/ingredients.ts';
  import { formatAmount } from '../../../../shared/quantities.ts';
  import { PACKAGE_UNITS } from '../../lib/menu.ts';

  // Relier les produits du stock aux ingrédients des recettes : la correspondance devinée (mots du nom, contenance)
  // se confirme une fois, puis elle est retenue par produit ; « Changer » choisit un autre ingrédient ou une autre
  // contenance, « Pas un ingrédient » ne le propose plus. Ce qui est relié et en stock est retiré des courses.
  type Props = {
    products: MenuStockProduct[];
    ingredients: { key: string; name: string }[];
    editable: boolean;
    busy: boolean;
    onLink: (product: MenuStockProduct, link: StockLink | null) => void;
    onForget: (product: MenuStockProduct) => void;
    onClose: () => void;
  };
  let { products, ingredients, editable, busy, onLink, onForget, onClose }: Props = $props();

  let editing = $state<string | null>(null);
  let name = $state('');
  let quantity = $state<number | null>(null);
  let unit = $state<Unit>('g');

  function edit(product: MenuStockProduct) {
    editing = product.code;
    name = product.link?.name ?? '';
    quantity = product.link?.per?.quantity ?? null;
    unit = product.link?.per?.unit ?? 'g';
  }

  function save(product: MenuStockProduct) {
    const chosen = name.trim();
    if (!chosen) return;
    const known = ingredients.find((i) => i.name.toLowerCase() === chosen.toLowerCase());
    const key = known?.key ?? ingredientKey(chosen);
    onLink(product, { key, name: known?.name ?? chosen, per: quantity && quantity > 0 ? { quantity, unit } : null });
    editing = null;
  }

  const describe = (link: StockLink) => `${link.name}${link.per ? `, ${formatAmount(link.per)} par paquet` : ', contenance inconnue'}`;
  const proposals = $derived(products.filter((p) => !p.decided));
  const decided = $derived(products.filter((p) => p.decided));
</script>

<div class="links">
  <h2>Stock et ingrédients</h2>
  <p class="muted">Un produit relié et en stock est retiré des courses du menu, ou sa quantité en est déduite.</p>

  {#snippet row(product: MenuStockProduct)}
    <li>
      <div class="product">
        <strong>{product.name}</strong>
        <span class="muted">{product.quantity ?? 'contenance ?'} · {product.count} en stock</span>
      </div>
      {#if editing === product.code}
        <form class="editor" onsubmit={(e) => (e.preventDefault(), save(product))}>
          <input list="menu-ingredients" bind:value={name} placeholder="Ingrédient (lardons, lait…)" aria-label="Ingrédient" maxlength="80" />
          <div class="amount">
            <input type="number" min="0" step="any" bind:value={quantity} placeholder="Par paquet" aria-label="Quantité par paquet" />
            <select bind:value={unit} aria-label="Unité">
              {#each PACKAGE_UNITS as option (option.unit)}<option value={option.unit}>{option.label}</option>{/each}
            </select>
          </div>
          <div class="actions">
            <button type="button" class="btn small" onclick={() => (editing = null)}>Annuler</button>
            <button type="submit" class="btn small primary" disabled={busy || !name.trim()}>Relier</button>
          </div>
        </form>
      {:else}
        <p class="link">
          {#if product.link}→ {describe(product.link)}{:else}Pas un ingrédient{/if}
        </p>
        {#if editable}
          <div class="actions">
            {#if !product.decided && product.link}
              <button type="button" class="btn small primary" disabled={busy} onclick={() => onLink(product, product.link)}>Confirmer</button>
            {/if}
            <button type="button" class="btn small" disabled={busy} onclick={() => edit(product)}>Changer</button>
            {#if !product.decided}
              <button type="button" class="btn small" disabled={busy} onclick={() => onLink(product, null)}>Pas un ingrédient</button>
            {:else}
              <button type="button" class="btn small" disabled={busy} onclick={() => onForget(product)}>Oublier</button>
            {/if}
          </div>
        {/if}
      {/if}
    </li>
  {/snippet}

  {#if proposals.length > 0}
    <h3>À confirmer</h3>
    <ul>{#each proposals as product (product.code)}{@render row(product)}{/each}</ul>
  {/if}
  {#if decided.length > 0}
    <h3>Déjà reliés</h3>
    <ul>{#each decided as product (product.code)}{@render row(product)}{/each}</ul>
  {/if}
  {#if products.length === 0}
    <p class="muted">Aucun produit du stock ne ressemble à un ingrédient pour l’instant.</p>
  {/if}

  <datalist id="menu-ingredients">
    {#each ingredients as ingredient (ingredient.key)}<option value={ingredient.name}></option>{/each}
  </datalist>

  <div class="close"><button type="button" class="btn" onclick={onClose}>Fermer</button></div>
</div>

<style>
  .links {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  h3 {
    margin: var(--space-1) 0 0;
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .product {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: baseline;
  }

  .link {
    margin: 0;
    color: var(--fg-soft);
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .editor input,
  .editor select {
    min-height: 48px;
    padding: 0 14px;
    border: 2px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, var(--text-body));
    min-width: 0;
  }

  .amount {
    display: flex;
    gap: 8px;
  }

  .amount input {
    flex: 1;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* Dans une carte (--surface-2), les boutons secondaires prennent le fond de la page pour rester visibles. */
  li .btn:not(.primary) {
    background: var(--surface);
  }

  .close {
    display: flex;
    justify-content: flex-end;
  }

  .muted {
    color: var(--fg-muted);
    font-size: var(--text-small);
  }
</style>
