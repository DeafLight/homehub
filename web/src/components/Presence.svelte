<script lang="ts">
  import { onMount } from 'svelte';
  import { getAppContext } from '../lib/context.ts';
  import { cameraError, prepareFaces, readFace, startCamera } from '../lib/face.ts';
  import { isPhoneRoute } from '../lib/route.ts';

  // Caméra de la tablette, discrète : environ une analyse par seconde tant que l'écran est allumé (veille comprise),
  // pour savoir qui est devant (voir lib/actor.svelte.ts) et réveiller la tablette quand quelqu'un arrive. Invisible,
  // sauf quand un geste attend une reconnaissance : une petite bulle montre alors l'image de la caméra. Éteinte sur
  // les téléphones et sur la page Visages (qui a besoin de la caméra).
  const TICK_MS = 1_000;
  /** Un geste attend : on analyse plus souvent. */
  const FAST_TICK_MS = 300;
  /** Caméra refusée ou absente : nouvel essai après ce délai. */
  const RETRY_MS = 60_000;

  const { api, actor, router } = getAppContext();

  let kiosk = $state(false);
  let visible = $state(document.visibilityState === 'visible');
  let video = $state<HTMLVideoElement>();

  onMount(() => {
    void actor.isKiosk().then((value) => (kiosk = value));
    const onVisibility = () => (visible = document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  const active = $derived(kiosk && visible && !isPhoneRoute(router.route) && router.route.name !== 'faces');

  $effect(() => {
    if (!active || !video) return;
    const el = video;
    let stopped = false;
    let stopCamera = () => {};
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    (async () => {
      while (!stopped) {
        try {
          const stop = await startCamera(el);
          if (stopped) return stop();
          stopCamera = stop;
          await prepareFaces();
          actor.setCamera('on');
          while (!stopped) {
            const reading = await readFace(el);
            if (stopped) return;
            if (reading) actor.sawFace();
            if (!reading?.embedding.length) {
              actor.report(null);
            } else {
              const { embedding, real, live } = reading;
              actor.report(await api.identifyFace({ embedding, real, live }).catch(() => null));
            }
            await pause(actor.waiting ? FAST_TICK_MS : TICK_MS);
          }
        } catch (err) {
          if (stopped) return;
          stopCamera();
          actor.setCamera('error', cameraError(err));
          await pause(RETRY_MS);
        }
      }
    })();

    return () => {
      stopped = true;
      stopCamera();
      actor.setCamera('off');
    };
  });
</script>

{#if active}
  <div class="presence" class:waiting={actor.waiting} aria-hidden={!actor.waiting}>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} muted playsinline></video>
    {#if actor.waiting}<span class="hint" role="status">Regarde la tablette</span>{/if}
  </div>
{/if}

<style>
  /* Hors attente : présente (la caméra doit tourner) mais invisible et sans gêner les gestes. */
  .presence {
    position: fixed;
    right: 0;
    bottom: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .presence.waiting {
    right: 32px;
    bottom: 32px;
    z-index: 35;
    width: auto;
    height: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 16px;
    overflow: visible;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.4);
    opacity: 1;
  }

  video {
    width: 160px;
    height: 160px;
    object-fit: cover;
    border-radius: 50%;
    transform: scaleX(-1); /* effet miroir : on se voit comme dans une glace */
  }

  .waiting video {
    border: 4px solid var(--rain);
  }

  .hint {
    font-size: 1.1rem;
    font-weight: 600;
  }
</style>
