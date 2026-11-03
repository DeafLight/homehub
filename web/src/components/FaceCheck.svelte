<script lang="ts">
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import { cameraError, prepareFaces, readFace, startCamera } from '../lib/face.ts';

  // « Qui es-tu ? » : au premier geste qui modifie, la caméra cherche un visage connu quelques secondes. Seule une
  // empreinte du visage part au serveur, qui la compare aux visages enregistrés.
  const LOOK_MS = 12_000;
  const PAUSE_MS = 400;

  const { api, actor } = getAppContext();

  let video = $state<HTMLVideoElement>();
  let status = $state<'loading' | 'looking' | 'failed'>('loading');
  let message = $state<string | null>(null);
  let attempt = $state(0);

  $effect(() => {
    if (!video) return;
    void attempt; // « Réessayer » relance la recherche
    const el = video;
    let stopped = false;
    let stopCamera = () => {};

    (async () => {
      status = 'loading';
      message = null;
      try {
        const stop = await startCamera(el);
        if (stopped) return stop();
        stopCamera = stop;
        await prepareFaces();
        status = 'looking';
        const deadline = Date.now() + LOOK_MS;
        while (!stopped && Date.now() < deadline) {
          const reading = await readFace(el);
          if (stopped) return;
          if (reading) {
            try {
              actor.recognized(await api.identifyFace(reading));
              return;
            } catch (err) {
              if (!(err instanceof ApiError && err.status === 401)) throw err;
              message = err.message;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
        }
        if (!stopped) status = 'failed';
      } catch (err) {
        if (stopped) return;
        status = 'failed';
        message = cameraError(err);
      } finally {
        stopCamera();
      }
    })();

    return () => {
      stopped = true;
      stopCamera();
    };
  });
</script>

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && actor.cancel()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Qui es-tu ?">
    <h2>Qui es-tu ?</h2>
    <div class="camera" class:off={status === 'failed'}>
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} muted playsinline></video>
    </div>
    <p class="status">
      {#if status === 'loading'}
        Préparation de la caméra…
      {:else if status === 'looking'}
        Regarde la tablette
      {:else}
        {message ?? 'Visage non reconnu'}
      {/if}
    </p>
    {#if status === 'looking' && message}<p class="muted">{message}</p>{/if}
    <div class="actions">
      <button type="button" class="secondary" onclick={() => actor.cancel()}>Annuler</button>
      {#if status === 'failed'}
        <button type="button" class="primary" onclick={() => attempt++}>Réessayer</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.6);
  }

  .dialog {
    width: min(480px, calc(100vw - 48px));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 28px;
    box-sizing: border-box;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  h2 {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 700;
  }

  .camera {
    width: 280px;
    height: 280px;
    overflow: hidden;
    border: 4px solid var(--rain);
    border-radius: 50%;
    background: var(--bg);
  }

  .camera.off {
    border-color: var(--surface-2);
    opacity: 0.4;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1); /* effet miroir : on se voit comme dans une glace */
  }

  .status {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    text-align: center;
  }

  .muted {
    margin: -8px 0 0;
    color: var(--fg-muted);
  }

  .actions {
    display: flex;
    gap: 12px;
  }

  button {
    min-height: 56px;
    padding: 0 28px;
    border: 0;
    border-radius: 18px;
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
  }

  .primary {
    background: var(--rain);
    color: var(--bg);
  }

  .secondary {
    background: var(--surface-2);
    color: var(--fg);
  }
</style>
