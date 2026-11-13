<script lang="ts">
  import { untrack } from 'svelte';
  import type { DateKind, LotChange, LotView } from '../../../../shared/types.ts';
  import { digitsOf, type PadMode, padDate, padDisplay, padHint, typeDigit } from '../../lib/date-pad.ts';
  import Icon from '../Icon.svelte';

  // Pavé de la date d'un lot (scanner, page Stock, téléphone) : DLC ou DDM (retenu par produit), jour et mois au pavé
  // (l'année se devine), « Mois et année seuls » pour une DDM « 03/2027 », « Même date que le précédent », « N à une
  // autre date… » (une partie du lot), « Passer » : rien n'est jamais exigé. Logique : lib/date-pad.ts.
  type Props = {
    title: string;
    lot: LotView;
    today: string;
    /** Dernière date donnée pendant ce passage (« Même date que le précédent »). */
    previous?: string | null;
    busy: boolean;
    onSave: (change: LotChange) => void;
    onSkip: () => void;
    /** « Ne plus demander » la date pour ce produit (scanner). */
    onNeverAsk?: () => void;
  };
  let { title, lot, today, previous = null, busy, onSave, onSkip, onNeverAsk }: Props = $props();

  let kind = $state<DateKind>(untrack(() => lot.dateKind));
  let digits = $state(untrack(() => digitsOf(lot.date)));
  let mode = $state<PadMode>('day');
  /** Unités à une autre date (null : tout le lot). */
  let split = $state<number | null>(null);

  const date = $derived(padDate(digits, mode, today));
  const unit = $derived(lot.count > 1 ? `${lot.count} unités` : '1 unité');

  function save() {
    if (!date) return;
    onSave(split !== null ? { kind, split: { count: split, date } } : { kind, date });
  }
</script>

<div class="pad">
  <h2>{title} <span class="muted">· {split !== null ? `${split} sur ${lot.count}` : unit}</span></h2>

  <div class="kinds" role="radiogroup" aria-label="Type de date">
    <button type="button" role="radio" aria-checked={kind === 'dlc'} class:on={kind === 'dlc'} onclick={() => (kind = 'dlc')}>À consommer jusqu’au</button>
    <button type="button" role="radio" aria-checked={kind === 'ddm'} class:on={kind === 'ddm'} onclick={() => (kind = 'ddm')}>De préférence avant</button>
  </div>

  <div class="shown" aria-live="polite">
    <strong>{padDisplay(digits)}</strong>
    <span class="muted">{padHint(digits, mode, today)}</span>
  </div>

  <div class="keys">
    {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as d (d)}
      <button type="button" onclick={() => (digits = typeDigit(digits, d))}>{d}</button>
    {/each}
  </div>

  <div class="row">
    <button type="button" class="btn small" aria-label="Effacer un chiffre" disabled={!digits} onclick={() => (digits = digits.slice(0, -1))}><Icon name="back" size={20} /> Effacer</button>
    {#if previous}
      <button
        type="button"
        class="btn small"
        onclick={() => {
          mode = 'day';
          digits = digitsOf(previous);
        }}>Même date que le précédent</button
      >
    {/if}
    <button
      type="button"
      class="btn small"
      class:on={mode === 'month'}
      aria-pressed={mode === 'month'}
      onclick={() => {
        mode = mode === 'month' ? 'day' : 'month';
        digits = '';
      }}>Mois et année seuls</button
    >
  </div>

  {#if split !== null}
    <div class="row split">
      <span>À cette date :</span>
      <button type="button" class="btn small" aria-label="Une de moins" disabled={split <= 1} onclick={() => (split = (split ?? 1) - 1)}><Icon name="minus" size={20} /></button>
      <strong>{split}</strong>
      <button type="button" class="btn small" aria-label="Une de plus" disabled={split >= lot.count - 1} onclick={() => (split = (split ?? 1) + 1)}><Icon name="plus" size={20} /></button>
      <span class="muted">sur {lot.count}</span>
    </div>
  {/if}

  <div class="row actions">
    <button type="button" class="btn" onclick={onSkip}>Passer</button>
    {#if lot.count > 1 && split === null}
      <button type="button" class="btn" onclick={() => (split = 1)}>{lot.count > 2 ? 'Une partie' : '1'} à une autre date…</button>
    {/if}
    {#if onNeverAsk}
      <button type="button" class="btn" disabled={busy} onclick={onNeverAsk}>Ne plus demander</button>
    {/if}
    {#if lot.date && split === null}
      <button type="button" class="btn" disabled={busy} onclick={() => onSave({ date: null })}>Retirer la date</button>
    {/if}
    <button type="button" class="btn primary" disabled={busy || !date} onclick={save}>Enregistrer</button>
  </div>
</div>

<style>
  .pad {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  .muted {
    color: var(--fg-muted);
    font-weight: 400;
  }

  .kinds {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 999px;
    background: var(--surface-2);
  }

  .kinds button {
    flex: 1;
    min-height: 48px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-size: var(--text-small);
    font-weight: 600;
  }

  .kinds button.on {
    background: var(--bg);
    color: var(--fg);
  }

  .shown {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .shown strong {
    font-size: var(--text-heading);
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
  }

  .keys {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-1);
  }

  .keys button {
    min-height: 56px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-title);
    font-weight: 600;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .row .on {
    background: var(--rain);
    color: var(--bg);
  }

  .split strong {
    min-width: 2ch;
    font-size: var(--text-title);
    text-align: center;
  }

  .actions .primary {
    margin-left: auto;
  }
</style>
