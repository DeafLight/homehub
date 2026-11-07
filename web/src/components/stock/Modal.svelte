<script lang="ts">
  import type { Snippet } from 'svelte';

  // Fenêtre posée sur la page (scanner, stock) : toucher à côté ferme, sauf `locked` (une réponse est attendue).
  type Props = { label: string; onClose?: () => void; locked?: boolean; wide?: boolean; children: Snippet };
  let { label, onClose, locked = false, wide = false, children }: Props = $props();
</script>

<div class="overlay" role="presentation" onclick={(e) => !locked && e.target === e.currentTarget && onClose?.()}>
  <div class="dialog" class:wide role="dialog" aria-modal="true" aria-label={label}>
    {@render children()}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    padding: var(--space-2);
    background: rgb(0 0 0 / 0.65);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(560px, 100%);
    max-height: calc(100dvh - 2 * var(--space-2));
    padding: var(--space-3);
    box-sizing: border-box;
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow-y: auto;
  }

  .dialog.wide {
    width: min(760px, 100%);
  }
</style>
