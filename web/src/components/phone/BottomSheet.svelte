<script lang="ts">
  import type { Snippet } from 'svelte';

  // Feuille qui monte du bas de l'écran du téléphone (laisser un mot, ajouter) ; un toucher à côté la ferme.
  type Props = { label: string; onClose: () => void; children: Snippet };
  let { label, onClose, children }: Props = $props();
</script>

<div class="sheet-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="sheet" role="dialog" aria-modal="true" aria-label={label}>
    {@render children()}
  </div>
</div>

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgb(0 0 0 / 60%);
  }

  .sheet {
    width: 100%;
    max-width: 640px;
    max-height: 92dvh;
    box-sizing: border-box;
    padding: 22px 16px calc(16px + env(safe-area-inset-bottom));
    border-radius: 26px 26px 0 0;
    background: var(--surface);
    overflow-y: auto;
  }

  .sheet :global(textarea) {
    font-size: max(16px, 1.1rem);
  }
</style>
