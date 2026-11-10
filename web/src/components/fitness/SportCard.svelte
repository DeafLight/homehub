<script lang="ts">
  import type { Snippet } from 'svelte';

  // Carte de l'onglet Sport : fond, titre et paragraphes communs à toutes les cartes. `highlight` : encadrée (bilan
  // de la semaine, à traiter d'abord).
  type Props = { highlight?: boolean; label?: string; children: Snippet };
  let { highlight = false, label, children }: Props = $props();
</script>

<section class="card" class:highlight aria-label={label}>
  {@render children()}
</section>

<style>
  .card {
    margin-bottom: 14px;
    padding: 14px 16px;
    border-radius: 18px;
    background: var(--surface);
  }

  .card :global(h2) {
    margin: 0 0 6px;
    font-size: 1.25rem;
  }

  .card :global(p) {
    margin: 0 0 8px;
  }

  .highlight {
    border: 2px solid var(--rain);
  }
</style>
