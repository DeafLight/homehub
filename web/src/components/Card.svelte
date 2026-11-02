<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = { title?: string; children: Snippet };
  let { title, children }: Props = $props();
</script>

<section class="card">
  {#if title}
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
