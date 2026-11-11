<script lang="ts">
  import type { SaveState } from '../lib/autosave.ts';
  import Icon from './Icon.svelte';

  // État de l'enregistrement automatique, posé à côté de ce qu'il concerne (titre d'une carte, choix) : rien tant que
  // la zone n'a pas été touchée, puis « Enregistrement… », « Enregistré » ou le problème, avec « Annuler » pour
  // revenir à ce qui est enregistré quand l'enregistrement est refusé.
  type Props = { state: SaveState; zone: string; onUndo?: () => void };
  let { state: save, zone, onUndo }: Props = $props();

  const here = $derived(save.kind !== 'idle' && save.zone === zone ? save : null);
</script>

<span class="save-status" role="status" aria-live="polite">
  {#if here?.kind === 'pending' || here?.kind === 'saving'}
    <span class="pill busy">Enregistrement…</span>
  {:else if here?.kind === 'saved'}
    <span class="pill ok"><Icon name="check" size={20} strokeWidth={2.4} /> Enregistré</span>
  {:else if here?.kind === 'problem'}
    <span class="pill problem">{here.text}</span>
    {#if onUndo}
      <button type="button" class="undo" onclick={onUndo}>Annuler</button>
    {/if}
  {/if}
</span>

<style>
  .save-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
    /* La pastille dépasse la ligne du titre sans le rehausser : rien ne bouge quand elle apparaît. */
    margin-block: -6px;
    min-width: 0;
    font-size: var(--text-small);
    font-weight: 600;
    letter-spacing: normal;
    text-transform: none;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 14px;
    border-radius: 999px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .busy {
    background: var(--surface-2);
    color: var(--fg-muted);
  }

  .ok {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }

  .problem {
    background: var(--danger-bg);
    color: var(--danger-fg);
    white-space: normal;
  }

  .undo {
    min-height: 36px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
</style>
