<script lang="ts">
  import type { VideoShare } from '../../../shared/video.ts';
  import Icon from '../components/Icon.svelte';
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import { loadPairing } from '../lib/phone.ts';
  import { phonePath } from '../lib/route.ts';
  import { formatStart } from '../lib/youtube.ts';

  // « Lire sur la tablette » (/partager avec un lien YouTube, reconnu par lib/youtube.ts avant l'import de recette) :
  // la vidéo partagée depuis l'appli YouTube part sur la tablette, qui la lance toute seule, en grand. Seuls
  // l'identifiant de la vidéo et l'instant de départ sont envoyés ; tout téléphone appairé peut le faire (le serveur
  // le vérifie). Aucune image ni requête vers YouTube depuis le téléphone.
  const { video }: { video: VideoShare } = $props();
  const { api, navigate } = getAppContext();
  const paired = loadPairing() !== null;

  let busy = $state(false);
  let sent = $state(false);
  let error = $state<string | null>(null);

  async function play() {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await api.sendTabletVideo(video);
      sent = true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return navigate(phonePath('shopping'));
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="share">
  <header>
    <button type="button" class="back" aria-label="Retour à l’appli" onclick={() => navigate(phonePath('shopping'))}><Icon name="back" size={28} strokeWidth={2.2} /></button>
    <h1>Vidéo YouTube</h1>
  </header>

  {#if !paired}
    <p class="muted">Ce téléphone n’est pas relié à HomeHub : appaire-le d’abord depuis la tablette.</p>
  {:else}
    <div class="card">
      <span class="badge"><Icon name="video" size={34} /></span>
      <div class="what">
        <strong>Vidéo partagée depuis YouTube</strong>
        <span class="muted">{video.start > 0 ? `À partir de ${formatStart(video.start)}` : 'Depuis le début'}</span>
      </div>
    </div>

    <button type="button" class="btn primary wide" disabled={busy} onclick={play}>
      <Icon name="tablet" size={24} />
      {busy ? 'Envoi…' : sent ? 'Relancer sur la tablette' : 'Lire sur la tablette'}
    </button>
    <p class="muted small">
      La lecture démarre toute seule, en grand, sur la tablette. Elle peut la réduire en vignette et continuer pendant
      qu’on se sert des autres écrans.
    </p>

    <p class="feedback" role="status" class:error={error !== null} class:quiet={!(error || sent)}>
      {#if error}
        {error}
      {:else if sent}
        <Icon name="check" size={22} /> Envoyé sur la tablette
      {/if}
    </p>
  {/if}
</div>

<style>
  .share {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 640px;
    height: 100dvh;
    margin: 0 auto;
    padding: calc(12px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .share > :global(*) {
    flex-shrink: 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .back {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface);
    color: var(--fg);
  }

  h1 {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 700;
  }

  .card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 18px 16px;
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .badge {
    display: grid;
    width: 64px;
    height: 64px;
    flex-shrink: 0;
    place-items: center;
    border-radius: var(--radius-md);
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 1.05rem;
  }

  .wide {
    display: inline-flex;
    width: 100%;
    min-height: 60px;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 1.15rem;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.9rem;
  }

  .feedback {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 0;
    padding: 14px 16px;
    border-radius: var(--radius-lg);
    background: var(--ok-bg);
    color: var(--ok-fg);
    font-weight: 600;
    text-align: center;
  }

  .feedback.error {
    background: var(--danger-bg);
    color: var(--danger-fg);
    font-weight: 400;
  }

  .feedback.quiet {
    display: none;
  }
</style>
