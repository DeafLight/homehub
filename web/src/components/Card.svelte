<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { DetailName } from '../lib/route.ts';
  import DetailLink from './DetailLink.svelte';

  // `link` : le titre ouvre une page de détail (ex. la semaine depuis « Cette semaine »). `aside` : ce qui se range à
  // droite de l'étiquette (légende d'un graphique). `grow` : la carte prend la hauteur qui reste dans sa colonne.
  type Props = { title?: string; link?: { to: DetailName; label: string }; aside?: Snippet; grow?: boolean; children: Snippet };
  let { title, link, aside, grow = false, children }: Props = $props();
</script>

<section class="card" class:grow>
  {#if title || aside}
    <div class="head">
      {#if title && link}
        <h2 class="card-label">
          <DetailLink to={link.to} label={link.label} chevronSize={20}>{title}</DetailLink>
        </h2>
      {:else if title}
        <h2 class="card-label">{title}</h2>
      {/if}
      {@render aside?.()}
    </div>
  {/if}
  {@render children()}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  .grow {
    flex-grow: 1;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
</style>
