<script lang="ts">
  import { untrack } from 'svelte';
  import { isLooseCode } from '../../../../shared/barcode.ts';
  import type { ProductInfo } from '../../../../shared/types.ts';
  import { STOCK_CATEGORIES } from '../../lib/stock.ts';

  // Fiche d'un produit à saisir (code inconnu de la base) ou à corriger : notre version l'emporte ensuite sur la base.
  type Props = {
    title: string;
    code: string;
    initial?: Partial<ProductInfo> | null;
    hint?: string;
    submitLabel?: string;
    onSubmit: (info: ProductInfo) => Promise<void>;
    onCancel: () => void;
  };
  let { title, code, initial = null, hint, submitLabel = 'Enregistrer', onSubmit, onCancel }: Props = $props();

  const CATEGORIES = STOCK_CATEGORIES;
  /** Sans code-barres : ni marque ni contenance ici (la quantité se change à part). */
  const loose = untrack(() => isLooseCode(code));

  let name = $state(untrack(() => initial?.name ?? ''));
  let brand = $state(untrack(() => initial?.brand ?? ''));
  let quantity = $state(untrack(() => initial?.quantity ?? ''));
  let category = $state(untrack(() => initial?.category ?? ''));
  let busy = $state(false);
  let error = $state<string | null>(null);

  const clean = (value: string) => value.trim() || null;

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    busy = true;
    error = null;
    try {
      await onSubmit({ name: name.trim(), brand: clean(brand), quantity: clean(quantity), category: clean(category) });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<form onsubmit={submit}>
  <h2>{title}</h2>
  {#if loose}<p class="code">Produit sans code-barres</p>{:else}<p class="code">Code-barres {code}{#if hint} · {hint}{/if}</p>{/if}
  <label>
    Nom du produit
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={name} required maxlength="120" autofocus={!initial?.name} placeholder="Compote de pomme" />
  </label>
  {#if !loose}<div class="row">
    <label>
      Marque
      <input bind:value={brand} maxlength="60" placeholder="Facultatif" />
    </label>
    <label>
      Contenance
      <input bind:value={quantity} maxlength="60" placeholder="4 x 90 g" />
    </label>
  </div>{/if}
  <div class="field">
    <span>Rayon</span>
    <div class="chips">
      {#each CATEGORIES as choice (choice)}
        <button type="button" class:on={category === choice} onclick={() => (category = category === choice ? '' : choice)}>{choice}</button>
      {/each}
    </div>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  <div class="actions">
    <button type="button" class="secondary" onclick={onCancel}>Annuler</button>
    <button type="submit" class="primary" disabled={busy || !name.trim()}>{submitLabel}</button>
  </div>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  .code {
    margin: -8px 0 0;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }

  label,
  .field {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    color: var(--fg-muted);
    font-size: var(--text-small);
  }

  .row {
    display: flex;
    gap: var(--space-2);
  }

  input {
    min-height: 52px;
    padding: 0 14px;
    border: 2px solid var(--surface-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, var(--text-body));
  }

  input:focus {
    border-color: var(--rain);
    outline: none;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .chips button {
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
  }

  .chips button.on {
    background: var(--rain);
    color: var(--bg);
    font-weight: 600;
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-1);
  }

  .actions button {
    min-height: 52px;
    padding: 0 24px;
    border: 0;
    border-radius: 999px;
    font: inherit;
    font-weight: 600;
    font-size: var(--text-body);
  }

  .primary {
    background: var(--rain);
    color: var(--bg);
  }

  .primary:disabled {
    opacity: 0.5;
  }

  .secondary {
    background: var(--surface-2);
    color: var(--fg);
  }
</style>
