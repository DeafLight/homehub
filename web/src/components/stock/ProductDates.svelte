<script lang="ts">
  import { localDay } from '../../../../shared/dates.ts';
  import { EXPIRY_LIMITS, isFreshCategory, productDateKind } from '../../../../shared/expiry.ts';
  import type { DateKind, ExpirySettings, LotChange, LotView, Product, ProductPreferences } from '../../../../shared/types.ts';
  import { getAppContext } from '../../lib/context.ts';
  import Icon from '../Icon.svelte';
  import DatePad from './DatePad.svelte';
  import ExpiryPill from './ExpiryPill.svelte';

  // Dates de péremption dans la fiche d'un produit : chaque lot avec sa date (ou « Ajouter une date », pour le stock
  // rangé sans date ou la veille), le type de date retenu (DLC / DDM), « Date ? » au scan, et la durée d'un produit
  // sans date imprimée (« les pommes tiennent 3 semaines »), qui corrige celle du rayon. `lots` absent (scanner) :
  // seulement les réglages.
  type Props = {
    product: Product;
    lots: LotView[] | null;
    expiry: ExpirySettings | null;
    readOnly: boolean;
    onChange: (product: Product) => void;
  };
  let { product, lots, expiry, readOnly, onChange }: Props = $props();

  const { api, clock } = getAppContext();
  const today = $derived(localDay(clock.now));
  let editing = $state<LotView | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const kind = $derived(productDateKind(product));
  const rayonDays = $derived(product.current.category && expiry ? (expiry.defaults[product.current.category] ?? null) : null);
  const keep = $derived(product.keepDays ?? rayonDays);

  async function run(action: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await action();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  const prefs = (change: ProductPreferences) => run(async () => onChange(await api.setProductPreferences(product.code, change)));
  const saveLot = (lot: LotView, change: LotChange) =>
    run(async () => {
      const saved = await api.setLot(lot.id, change);
      editing = null;
      onChange(saved.product);
    });

  const ASK: { value: boolean | null; label: string }[] = [
    { value: null, label: 'D’après le rayon' },
    { value: true, label: 'Toujours' },
    { value: false, label: 'Ne plus demander' },
  ];
  const KINDS: { value: DateKind; label: string }[] = [
    { value: 'dlc', label: 'DLC · à consommer jusqu’au' },
    { value: 'ddm', label: 'DDM · de préférence avant' },
  ];
</script>

{#if editing}
  {@const lot = editing}
  <DatePad title={product.current.name} {lot} {today} {busy} onSave={(change) => saveLot(lot, change)} onSkip={() => (editing = null)} />
{:else}
  <section>
    <h3 class="card-label">Dates de péremption</h3>
    {#if lots?.length}
      <ul class="lots">
        {#each lots as lot (lot.id)}
          <li>
            <span class="count">{lot.count} ×</span>
            {#if lot.due}
              <ExpiryPill {lot} {today} onclick={readOnly ? undefined : () => (editing = lot)} />
            {:else}
              <span class="muted">sans date</span>
            {/if}
            {#if !readOnly && (lot.date === null || lot.estimated)}
              <button type="button" class="btn small" disabled={busy} onclick={() => (editing = lot)}><Icon name="plus" size={20} /> Ajouter une date</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if !readOnly}
      <div class="chips" role="radiogroup" aria-label="Type de date">
        {#each KINDS as k (k.value)}
          <button type="button" role="radio" aria-checked={kind === k.value} class:on={kind === k.value} disabled={busy} onclick={() => prefs({ dateKind: k.value })}>{k.label}</button>
        {/each}
      </div>
      <span class="label">« Date ? » au scan{product.askDate === null ? ` (${isFreshCategory(product.current.category) ? 'oui' : 'non'}, d’après le rayon)` : ''}</span>
      <div class="chips">
        {#each ASK as a (String(a.value))}
          <button type="button" class:on={product.askDate === a.value} disabled={busy} onclick={() => prefs({ askDate: a.value })}>{a.label}</button>
        {/each}
      </div>
      <span class="label">Sans date imprimée, il tient</span>
      <div class="stepper">
        <button type="button" class="btn small" aria-label="Un jour de moins" disabled={busy || !keep || keep <= 1} onclick={() => prefs({ keepDays: (keep ?? 2) - 1 })}><Icon name="minus" size={20} /></button>
        <strong>{keep ? `${keep} jour${keep > 1 ? 's' : ''}` : 'pas d’estimation'}</strong>
        <button type="button" class="btn small" aria-label="Un jour de plus" disabled={busy || (keep ?? 0) >= EXPIRY_LIMITS.keep} onclick={() => prefs({ keepDays: (keep ?? 0) + 1 })}><Icon name="plus" size={20} /></button>
        {#if product.keepDays !== null}
          <button type="button" class="btn small" disabled={busy} onclick={() => prefs({ keepDays: null })}>Comme le rayon{rayonDays ? ` (${rayonDays} j)` : ''}</button>
        {:else if keep}
          <span class="muted">durée du rayon {product.current.category}</span>
        {/if}
      </div>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
  </section>
{/if}

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .lots {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .lots li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .count {
    min-width: 3ch;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .muted {
    color: var(--fg-muted);
  }

  .label {
    color: var(--fg-muted);
    font-size: var(--text-small);
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

  .stepper {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }
</style>
