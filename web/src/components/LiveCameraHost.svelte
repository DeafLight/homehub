<script lang="ts">
  import { onMount } from 'svelte';
  import { cameraBanner } from '../../../shared/camera.ts';
  import { getAppContext } from '../lib/context.ts';
  import { createLiveHost, pageClientId, type Talker } from '../lib/live-camera.ts';
  import { loadPairing } from '../lib/phone.ts';
  import { hostsLiveCamera } from '../lib/route.ts';
  import Icon from './Icon.svelte';

  // Caméra en direct, côté tablette : écoute les demandes des téléphones des parents et diffuse la caméra de face
  // (lib/live-camera.ts). Pendant une diffusion, bandeau « Caméra en direct · <parent> » en haut de tous les écrans,
  // veille comprise, sauf si `camera.banner: false`. Quand un parent parle : carillon, puis sa voix sur les
  // haut-parleurs et le bandeau « Alex parle », toujours affiché (même avec `camera.banner: false`). Rien sur les
  // téléphones (pages /m, appareil appairé) ni quand `camera.live` est coupé.
  const { api, actor, config, router } = getAppContext();

  let kiosk = $state(false);
  let viewers = $state<string[]>([]);
  let talkers = $state<Talker[]>([]);
  onMount(() => void actor.isKiosk().then((value) => (kiosk = value)));

  const hosting = $derived(kiosk && config.camera.live && hostsLiveCamera(router.route) && !loadPairing() && typeof RTCPeerConnection !== 'undefined');

  $effect(() => {
    if (!hosting) return;
    const host = createLiveHost({
      api,
      client: pageClientId(),
      createPeer: (rtc) => new RTCPeerConnection(rtc),
      onViewers: (names) => (viewers = names),
      onTalkers: (list) => (talkers = list),
    });
    return () => {
      host.stop();
      talkers = [];
    };
  });

  const banner = $derived(hosting ? cameraBanner(viewers, talkers.map((t) => t.name), config.camera.banner) : null);

  /** Joue la voix d'un parent. Sans lecture automatique permise (Fully : Autoplay Audio), réessaie au premier toucher. */
  function play(el: HTMLAudioElement, voice: MediaStream | null) {
    const start = (stream: MediaStream | null) => {
      el.srcObject = stream;
      if (!stream) return;
      el.play().catch(() => {
        const retry = () => void el.play().catch(() => {});
        window.addEventListener('pointerdown', retry, { once: true });
      });
    };
    start(voice);
    return {
      update: start,
      destroy: () => (el.srcObject = null),
    };
  }
</script>

{#if banner}
  <div class="live" class:talk={banner.talk} role="status">
    <span class="dot" aria-hidden="true"></span>
    <Icon name={banner.talk ? 'mic' : 'video'} size={22} />
    {banner.text}
  </div>
{/if}
{#each talkers as talker (talker.session)}
  <audio use:play={talker.voice} autoplay></audio>
{/each}

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

  .live.talk {
    padding: 14px 28px;
    font-size: var(--text-body);
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
