<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PageRoute } from '../lib/route.ts';
  import BackButton from './BackButton.svelte';

  // En-tête des pages de détail (piste A) : retour vers la page d'origine, titre et sous-titre, puis ce que la page
  // met à droite (navigation entre semaines, source de la météo…).
  type Props = { back: PageRoute; title: string; subtitle?: string | null; children?: Snippet };
  let { back, title, subtitle = null, children }: Props = $props();
</script>

<header class="page-header">
  <BackButton {back} />
  <div class="titles">
    <h1>{title}</h1>
    {#if subtitle}
      <span class="subtitle">{subtitle}</span>
    {/if}
  </div>
  {#if children}
    <div class="side">{@render children()}</div>
  {/if}
</header>

<style>
  .page-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 72px;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-size: var(--text-heading);
    font-weight: 600;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .subtitle {
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .side {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
    flex-shrink: 0;
  }
</style>
