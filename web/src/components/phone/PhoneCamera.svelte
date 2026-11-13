<script lang="ts">
  import { onMount } from 'svelte';
  import type { Api } from '../../lib/api.ts';
  import { createLiveViewer, type LiveViewer, type ViewerState } from '../../lib/live-camera.ts';
  import Icon from '../Icon.svelte';

  // Onglet Caméra (parents) : la caméra de face de la tablette en direct, avec le son. La diffusion démarre à
  // l'ouverture de l'onglet et s'arrête en le quittant ou quand la page est masquée (écran éteint, autre appli) ;
  // elle reprend au retour sur la page. La tablette affiche un bandeau tant qu'on regarde (sauf réglage contraire).
  type Props = { api: Api; bannerShown: boolean };
  let { api, bannerShown }: Props = $props();

  let view = $state<ViewerState>({ phase: 'connecting' });
  let stream = $state<MediaStream | null>(null);
  let video = $state<HTMLVideoElement>();
  let muted = $state(false);
  let viewer: LiveViewer | null = null;

  function start() {
    viewer?.stop();
    if (typeof RTCPeerConnection === 'undefined') {
      view = { phase: 'error', message: 'Ce navigateur ne sait pas recevoir la vidéo en direct (WebRTC).' };
      return;
    }
    viewer = createLiveViewer({
      api,
      createPeer: (rtc) => new RTCPeerConnection(rtc),
      onState: (s) => (view = s),
      onStream: (s) => (stream = s),
    });
  }

  function stop() {
    viewer?.stop();
    viewer = null;
  }

  onMount(() => {
    if (document.visibilityState === 'visible') start();
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
    document.addEventListener('visibilitychange', onVisibility);
    // Fermeture de l'appli : la demande part quand même (keepalive).
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  });

  $effect(() => {
    if (!video) return;
    video.srcObject = stream;
    if (!stream) return;
    // Le son demande souvent un geste : sans lui, on démarre sans le son et le bouton le propose.
    const el = video;
    el.play().catch(() => {
      muted = true;
      el.muted = true;
      void el.play().catch(() => {});
    });
  });
</script>

<div class="camera">
  <div class="screen">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} autoplay playsinline {muted} class:hidden={view.phase !== 'live'}></video>
    {#if view.phase === 'connecting'}
      <p class="overlay">Connexion à la tablette…</p>
    {:else if view.phase === 'ended' || view.phase === 'error'}
      <div class="overlay">
        <p class:error={view.phase === 'error'}>{view.message}</p>
        <button type="button" class="btn" onclick={start}><Icon name="refresh" size={22} /> Relancer</button>
      </div>
    {/if}
  </div>

  {#if view.phase === 'live'}
    <div class="bar">
      <span class="live-dot" aria-hidden="true"></span> En direct
      {#if view.audio}
        <button type="button" class="btn sound" aria-pressed={!muted} onclick={() => (muted = !muted)}>
          <Icon name={muted ? 'mute' : 'volume'} size={22} />
          {muted ? 'Activer le son' : 'Couper le son'}
        </button>
      {/if}
    </div>
  {/if}

  <p class="muted">
    {bannerShown ? 'La tablette affiche « Caméra en direct » avec ton prénom tant que tu regardes.' : 'Le bandeau de la tablette est désactivé (camera.banner).'}
    La diffusion s’arrête quand tu quittes cet onglet ; rien n’est enregistré.
  </p>
</div>

<style>
  .camera {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .screen {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: var(--bg);
  }

  video.hidden {
    visibility: hidden;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3);
    color: var(--fg-muted);
    text-align: center;
  }

  .overlay p {
    margin: 0;
  }

  .error {
    color: var(--danger-fg);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .live-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--bad);
  }

  .sound {
    margin-left: auto;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.95rem;
  }
</style>
