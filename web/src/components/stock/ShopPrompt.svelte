<script lang="ts">
  import { getAppContext } from '../../lib/context.ts';

  // Produit épuisé : l'ajouter à la liste de courses ? Oui, oui et d'office la prochaine fois, ou non.
  type Props = { code: string; label: string; onDone: (added: boolean) => void };
  let { code, label, onDone }: Props = $props();

  const { api } = getAppContext();
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function add(always: boolean) {
    busy = true;
    error = null;
    try {
      await api.shopProduct(code, always);
      onDone(true);
    } catch (err) {
      error = (err as Error).message;
      busy = false;
    }
  }
</script>

<h2>Plus de « {label} »</h2>
<p>L’ajouter à la liste de courses ?</p>
{#if error}<p class="error">{error}</p>{/if}
<div class="actions">
  <button type="button" class="btn primary" disabled={busy} onclick={() => add(false)}>Oui</button>
  <button type="button" class="btn" disabled={busy} onclick={() => add(true)}>Oui, et toujours d’office</button>
  <button type="button" class="btn" disabled={busy} onclick={() => onDone(false)}>Non</button>
</div>

<style>
  h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  p {
    margin: 0;
    color: var(--fg-soft);
    font-size: var(--text-body);
  }

  .error {
    color: var(--danger-fg);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
</style>
