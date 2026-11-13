<script lang="ts">
  import { onDestroy } from 'svelte';
  import BackButton from '../components/BackButton.svelte';
  import PhonesPanel from '../components/PhonesPanel.svelte';
  import ScreensPanel from '../components/ScreensPanel.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import type { PageRoute } from '../lib/route.ts';

  // Téléphones reliés à la famille, ouverts depuis la roue dentée : en relier un (QR code), en retirer. En dessous, les
  // télés avec l'appli HomeHub TV (appairage par le code affiché sur la télé). Réservé à la tablette.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api } = getAppContext();
  const me = createResource(() => api.me(), 60_000);
  onDestroy(me.destroy);
</script>

<div class="phones-page">
  <header>
    <BackButton {back} />
    <h1>Téléphones</h1>
  </header>

  {#if me.data?.kiosk}
    <PhonesPanel />
    <ScreensPanel />
  {:else if me.data}
    <p class="muted">Réservé à la tablette.</p>
  {/if}
</div>

<style>
  .phones-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 28px 40px 36px;
    box-sizing: border-box;
  }

  header {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  h1 {
    margin: 0;
    font-size: 2.5rem;
    font-weight: 600;
  }

  .muted {
    font-size: 1.2rem;
    color: var(--fg-muted);
  }
</style>
