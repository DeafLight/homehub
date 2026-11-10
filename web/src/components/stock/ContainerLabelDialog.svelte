<script lang="ts">
  import { untrack } from 'svelte';
  import type { Container } from '../../../../shared/types.ts';
  import Icon from '../Icon.svelte';
  import ContainerLabel from './ContainerLabel.svelte';
  import Modal from './Modal.svelte';

  // Étiquette d'un contenant (page Stock) : à imprimer et coller dessus ; on peut aussi le renommer ou le retirer.
  // À l'impression, seule l'étiquette sort.
  type Props = {
    container: Container;
    readOnly: boolean;
    busy: boolean;
    onRename: (name: string) => void;
    onRemove: () => void;
    onClose: () => void;
  };
  let { container, readOnly, busy, onRename, onRemove, onClose }: Props = $props();

  let name = $state(untrack(() => container.name));
</script>

<Modal label="Étiquette du contenant" {onClose}>
  <div class="printable"><ContainerLabel name={container.name} code={container.code} /></div>
  <p class="muted small">Imprime l’étiquette et colle-la sur le contenant : scannée en mode « Jeté / épuisé », elle le déclare vide.</p>
  {#if !readOnly}
    <form
      class="add"
      onsubmit={(e) => {
        e.preventDefault();
        onRename(name.trim());
      }}
    >
      <input bind:value={name} maxlength="60" aria-label="Nom du contenant" />
      <button type="submit" class="btn small" disabled={busy || !name.trim() || name.trim() === container.name}>Renommer</button>
    </form>
  {/if}
  <div class="dialog-actions">
    <button type="button" class="btn primary" onclick={() => window.print()}><Icon name="printer" size={22} /> Imprimer</button>
    {#if !readOnly}
      <button type="button" class="btn" disabled={busy} onclick={onRemove}>
        <Icon name="trash" size={22} /> Retirer
      </button>
    {/if}
    <button type="button" class="btn" onclick={onClose}>Fermer</button>
  </div>
</Modal>

<style>
  .muted {
    color: var(--fg-muted);
  }

  .small {
    margin: 0;
    font-size: var(--text-small);
  }

  .add {
    display: flex;
    gap: var(--space-1);
  }

  .add input {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0 16px;
    border: 2px solid var(--surface-2);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, var(--text-small));
  }

  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  /* Impression : l'étiquette seule. */
  @media print {
    :global(body *) {
      visibility: hidden;
    }

    .printable,
    .printable :global(*) {
      visibility: visible;
    }

    .printable {
      position: fixed;
      top: 0;
      left: 0;
      width: 70mm;
    }
  }
</style>
