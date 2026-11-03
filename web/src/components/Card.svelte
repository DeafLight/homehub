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
    <h2>
      <DetailLink to={link.to} label={link.label} chevronSize={28}>{title}</DetailLink>
    </h2>
  {:else if title}
    <h2>{title}</h2>
  {/if}
  {@render children()}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    padding: 24px 28px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }
</style>
