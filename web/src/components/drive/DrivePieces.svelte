<script lang="ts">
  import { untrack } from 'svelte';
  import { DRIVE_LIMITS, type DriveProduct, piecesQuestion } from '../../../../shared/drive.ts';
  import { type Unit, unitLabel } from '../../../../shared/ingredients.ts';
  import type { Api } from '../../lib/api.ts';

  // « Combien de pièces dans ce paquet ? » : quand un article se compte en pièces (« 5 oignons ») et que le produit
  // retenu a une autre contenance (filet de 1 kg) ou aucune, on le demande une fois ; la réponse est retenue sur le
  // produit et sert au calcul des paquets. Déjà répondu : rappel discret, qu'on peut changer.
  type Props = {
    api: Api;
    itemKey: string;
    product: Pick<DriveProduct, 'id' | 'pieces'>;
    unit: Unit;
    readOnly?: boolean;
    onChanged: () => Promise<void> | void;
  };
  let { api, itemKey, product, unit, readOnly = false, onChanged }: Props = $props();

  let editing = $state(untrack(() => product.pieces === null));
  let value = $state<number | null>(untrack(() => product.pieces));
  let busy = $state(false);
  let error = $state<string | null>(null);
  const label = $derived(unit === 'piece' ? 'pièces' : unitLabel(unit, 2));

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const pieces = Number(value);
    if (!Number.isInteger(pieces) || pieces < 1 || busy) return;
    busy = true;
    error = null;
    try {
      await api.setDrivePieces(itemKey, product.id, pieces);
      editing = false;
      await onChanged();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

{#if editing && !readOnly}
  <form class="pieces ask" onsubmit={save}>
    <label for="pieces-{product.id}">{piecesQuestion(unit)}</label>
    <div class="row">
      <input id="pieces-{product.id}" type="number" inputmode="numeric" min="1" max={DRIVE_LIMITS.pieces} bind:value placeholder="6" />
      <button type="submit" class="btn primary small" disabled={busy || !value || value < 1}>OK</button>
      {#if product.pieces}<button type="button" class="btn small" onclick={() => (editing = false)}>Annuler</button>{/if}
    </div>
    {#if error}<p class="error">{error}</p>{/if}
  </form>
{:else if product.pieces}
  <p class="pieces">
    {product.pieces} {label} par paquet
    {#if !readOnly}<button type="button" class="link" onclick={() => (editing = true)}>Changer</button>{/if}
  </p>
{:else}
  <p class="pieces warn">{piecesQuestion(unit)}</p>
{/if}

<style>
  .pieces {
    margin: 0;
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .ask {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--warn-bg);
    color: var(--sun);
  }

  .warn {
    color: var(--sun);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  input {
    width: 96px;
    min-height: 44px;
    box-sizing: border-box;
    padding: 0 12px;
    border: 2px solid var(--surface-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, 1rem);
    user-select: text;
  }

  .link {
    margin-left: 6px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--rain-soft);
    font: inherit;
    font-weight: 600;
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }
</style>
