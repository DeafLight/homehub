<script lang="ts">
  import { onMount } from 'svelte';
  import { liveBanner } from '../../../shared/camera.ts';
  import { getAppContext } from '../lib/context.ts';
  import { createLiveHost, pageClientId } from '../lib/live-camera.ts';
  import { loadPairing } from '../lib/phone.ts';
  import { hostsLiveCamera } from '../lib/route.ts';
  import Icon from './Icon.svelte';

  // Caméra en direct, côté tablette : écoute les demandes des téléphones des parents et diffuse la caméra de face
  // (lib/live-camera.ts). Pendant une diffusion, bandeau « Caméra en direct · <parent> » en haut de tous les écrans,
  // veille comprise, sauf si `camera.banner: false`. Rien sur les téléphones (pages /m, appareil appairé) ni quand
  // `camera.live` est coupé.
  const { api, actor, config, router } = getAppContext();

  let kiosk = $state(false);
  let viewers = $state<string[]>([]);
  onMount(() => void actor.isKiosk().then((value) => (kiosk = value)));

  const hosting = $derived(kiosk && config.camera.live && hostsLiveCamera(router.route) && !loadPairing() && typeof RTCPeerConnection !== 'undefined');

  $effect(() => {
    if (!hosting) return;
    const host = createLiveHost({
      api,
      client: pageClientId(),
      createPeer: (rtc) => new RTCPeerConnection(rtc),
      onViewers: (names) => (viewers = names),
    });
    return () => host.stop();
  });

  const banner = $derived(hosting && config.camera.banner ? liveBanner(viewers) : null);
</script>

{#if banner}
  <div class="live" role="status">
    <span class="dot" aria-hidden="true"></span>
    <Icon name="video" size={22} />
    {banner}
  </div>
{/if}

<style>
  .live {
    position: fixed;
    top: 16px;
    left: 50%;
    z-index: 130; /* au-dessus de la veille */
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px;
    border-radius: 999px;
    background: var(--danger-bg);
    color: var(--danger-fg);
    font-size: var(--text-small);
    font-weight: 600;
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.4);
    pointer-events: none;
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--bad);
    animation: pulse 1.6s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
