<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { DetailName } from '../lib/route.ts';
  import DetailLink from './DetailLink.svelte';

  // `link` : le titre ouvre une page de détail (ex. la semaine depuis « Cette semaine »).
  type Props = { title?: string; link?: { to: DetailName; label: string }; children: Snippet };
  let { title, link, children }: Props = $props();
</script>

<section class="card">
  {#if title && link}
    <h2 class="card-label">
      <DetailLink to={link.to} label={link.label} chevronSize={20}>{title}</DetailLink>
    </h2>
  {:else if title}
    <h2 class="card-label">{title}</h2>
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
</style>
