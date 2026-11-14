<script lang="ts">
  import { untrack } from 'svelte';
  import { shortDay } from '../../../../shared/expiry.ts';
  import type { DateKind, LotChange, LotView } from '../../../../shared/types.ts';
  import { digitsOf, type PadMode, padDate, padDisplay, padExtras, padHint, typeDigit } from '../../lib/date-pad.ts';
  import Icon from '../Icon.svelte';

  // Pavé de la date d'un lot (scanner, page Stock, téléphone) : DLC ou DDM (retenu par produit), clavier 3 × 4 façon
  // téléphone (jour et mois, l'année se devine ; touche « Mois / an » pour une DDM « 03/2027 » ; touche d'effacement),
  // « Même date : 12/11 » (la dernière donnée), et sous « Plus » les options rares (une partie du lot à une autre date,
  // retirer la date, ne plus demander). « Passer » et « Enregistrer » restent fixés en bas de la fenêtre, même quand
  // elle défile sur un petit téléphone : rien n'est jamais exigé. Logique : lib/date-pad.ts.
  type Props = {
    title: string;
    lot: LotView;
    today: string;
    /** Dernière date donnée pendant ce passage (« Même date »). */
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
  /** Options rares dépliées. */
  let more = $state(false);

  const date = $derived(padDate(digits, mode, today));
  const unit = $derived(lot.count > 1 ? `${lot.count} unités` : '1 unité');
  const extras = $derived(padExtras(lot, split !== null, onNeverAsk !== undefined));

  function save() {
    if (!date) return;
    onSave(split !== null ? { kind, split: { count: split, date } } : { kind, date });
  }

  function toggleMonth() {
    mode = mode === 'month' ? 'day' : 'month';
    digits = '';
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
    {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d (d)}
      <button type="button" onclick={() => (digits = typeDigit(digits, d))}>{d}</button>
    {/each}
    <button type="button" class="word" class:on={mode === 'month'} aria-pressed={mode === 'month'} aria-label="Mois et année seuls" onclick={toggleMonth}>Mois / an</button>
    <button type="button" onclick={() => (digits = typeDigit(digits, '0'))}>0</button>
    <button type="button" aria-label="Effacer un chiffre" disabled={!digits} onclick={() => (digits = digits.slice(0, -1))}><Icon name="erase" size={26} /></button>
  </div>

  {#if previous || extras.length}
    <div class="row">
      {#if previous}
        <button
          type="button"
          class="chip same"
          onclick={() => {
            mode = 'day';
            digits = digitsOf(previous);
          }}>Même date : {shortDay(previous)}</button
        >
      {/if}
      {#if extras.length}
        <button type="button" class="chip" aria-expanded={more} onclick={() => (more = !more)}>
          Plus <span class="caret" class:open={more}><Icon name="chevron" size={16} /></span>
        </button>
      {/if}
    </div>
  {/if}

  {#if more && extras.length}
    <div class="row extras">
      {#if extras.includes('split')}
        <button type="button" class="btn small" onclick={() => (split = 1)}>{lot.count > 2 ? 'Une partie' : '1'} à une autre date…</button>
      {/if}
      {#if extras.includes('clear')}
        <button type="button" class="btn small" disabled={busy} onclick={() => onSave({ date: null })}>Retirer la date</button>
      {/if}
      {#if extras.includes('never') && onNeverAsk}
        <button type="button" class="btn small" disabled={busy} onclick={onNeverAsk}>Ne plus demander</button>
      {/if}
    </div>
  {/if}

  {#if split !== null}
    <div class="row split">
      <span>À cette date :</span>
      <button type="button" class="btn small" aria-label="Une de moins" disabled={split <= 1} onclick={() => (split = (split ?? 1) - 1)}><Icon name="minus" size={20} /></button>
      <strong>{split}</strong>
      <button type="button" class="btn small" aria-label="Une de plus" disabled={split >= lot.count - 1} onclick={() => (split = (split ?? 1) + 1)}><Icon name="plus" size={20} /></button>
      <span class="muted">sur {lot.count}</span>
    </div>
  {/if}

  <div class="foot">
    <button type="button" class="btn" onclick={onSkip}>Passer</button>
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
    min-height: 44px;
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
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-1);
  }

  .keys button {
    display: grid;
    min-height: 52px;
    place-items: center;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-title);
    font-weight: 600;
  }

  .keys button:disabled {
    color: var(--fg-muted);
  }

  .keys .word {
    font-size: var(--text-small);
  }

  .keys .on {
    background: var(--rain);
    color: var(--bg);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: none;
    color: var(--fg-soft);
    font: inherit;
    font-size: var(--text-small);
    font-weight: 600;
  }

  .chip.same {
    border: 1px dashed var(--rain-soft);
    background: var(--rain-bg);
    color: var(--rain-soft);
  }

  .caret {
    display: inline-grid;
    transform: rotate(90deg);
    transition: transform 0.15s;
  }

  .caret.open {
    transform: rotate(-90deg);
  }

  .split strong {
    min-width: 2ch;
    font-size: var(--text-title);
    text-align: center;
  }

  /* Passer et Enregistrer : fixés au bas de la fenêtre (Modal, qui défile), par-dessus sa marge du bas. */
  .foot {
    position: sticky;
    bottom: calc(-1 * var(--space-3));
    display: flex;
    gap: var(--space-1);
    margin-bottom: calc(-1 * var(--space-3));
    padding: var(--space-2) 0 var(--space-3);
    border-top: 1px solid var(--surface-2);
    background: var(--surface);
  }

  .foot .btn {
    flex: 1;
    justify-content: center;
  }

  .foot .primary {
    flex: 2;
  }
</style>
