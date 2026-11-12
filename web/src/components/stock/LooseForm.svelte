<script lang="ts">
  import { untrack } from 'svelte';
  import { isCounted, LOOSE_MAX_COUNT, LOOSE_UNIT_LABELS, LOOSE_UNITS, type LooseUnit, type NewLooseProduct, validLooseAmount } from '../../../../shared/loose.ts';
  import { parseAmount, STOCK_CATEGORIES } from '../../lib/stock.ts';

  // Produit sans code-barres (marché, vrac, fait maison) : nom, rayon, quantité avec son unité (1,2 kg de pommes,
  // 6 œufs, 1 botte de radis). `amountOnly` : seulement la nouvelle quantité d'un produit déjà là (« il reste 800 g »).
  type Props = {
    title: string;
    amountOnly?: boolean;
    initial?: { name?: string; category?: string | null; amount?: number; unit?: LooseUnit } | null;
    submitLabel?: string;
    onSubmit: (input: NewLooseProduct) => Promise<void>;
    onCancel: () => void;
  };
  let { title, amountOnly = false, initial = null, submitLabel = 'Ajouter au stock', onSubmit, onCancel }: Props = $props();

  let name = $state(untrack(() => initial?.name ?? ''));
  let category = $state(untrack(() => initial?.category ?? ''));
  let amountText = $state(untrack(() => (initial?.amount ? String(initial.amount).replace('.', ',') : '')));
  let unit = $state<LooseUnit>(untrack(() => initial?.unit ?? 'kg'));
  let busy = $state(false);
  let error = $state<string | null>(null);

  const amount = $derived(parseAmount(amountText));
  const valid = $derived(amount !== null && validLooseAmount(amount, unit));
  /** Pourquoi la quantité ne va pas (tapée seulement) : pièces entières, 99 au plus. */
  const amountHint = $derived(
    amountText.trim() === '' || valid ? null
    : amount === null ? 'Un nombre : 1,2 ou 6'
    : isCounted(unit) ? `Un nombre entier, ${LOOSE_MAX_COUNT} au plus`
    : 'Quantité trop grande',
  );
  const ready = $derived(valid && (amountOnly || name.trim() !== ''));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!ready || amount === null) return;
    busy = true;
    error = null;
    try {
      await onSubmit({ name: name.trim(), category: category || null, amount, unit });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<form onsubmit={submit}>
  <h2>{title}</h2>
  {#if !amountOnly}
    <p class="hint">Marché, vrac, fait maison : rien à scanner. Il se retrouve ensuite au stock et dans le menu comme les autres.</p>
    <label>
      Nom du produit
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={name} required maxlength="120" autofocus placeholder="Pommes" />
    </label>
  {/if}
  <div class="field">
    <span>Quantité</span>
    <div class="amount">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="number" bind:value={amountText} inputmode="decimal" autofocus={amountOnly} placeholder="1,2" aria-label="Quantité" aria-invalid={amountHint !== null} />
      <div class="chips" role="group" aria-label="Unité">
        {#each LOOSE_UNITS as choice (choice)}
          <button type="button" class:on={unit === choice} aria-pressed={unit === choice} onclick={() => (unit = choice)}>{LOOSE_UNIT_LABELS[choice]}</button>
        {/each}
      </div>
    </div>
    {#if amountHint}<span class="warn">{amountHint}</span>{/if}
  </div>
  {#if !amountOnly}
    <div class="field">
      <span>Rayon</span>
      <div class="chips">
        {#each STOCK_CATEGORIES as choice (choice)}
          <button type="button" class:on={category === choice} aria-pressed={category === choice} onclick={() => (category = category === choice ? '' : choice)}>{choice}</button>
        {/each}
      </div>
    </div>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
  <div class="actions">
    <button type="button" class="secondary" onclick={onCancel}>Annuler</button>
    <button type="submit" class="primary" disabled={busy || !ready}>{submitLabel}</button>
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

  .hint {
    margin: -8px 0 0;
    color: var(--fg-muted);
  }

  label,
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--fg-muted);
    font-size: var(--text-small);
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

  .amount {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .number {
    width: 110px;
    font-variant-numeric: tabular-nums;
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

  .warn {
    color: var(--warn);
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
