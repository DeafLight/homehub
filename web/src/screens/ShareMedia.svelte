<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { SharedMedia, ShareScreenTarget } from '../../../shared/screen-media.ts';
  import Icon from '../components/Icon.svelte';
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import { loadPairing } from '../lib/phone.ts';
  import { phonePath } from '../lib/route.ts';
  import { defaultTarget, mediaSize, sentNotice, type SharedMediaParam } from '../lib/share-media.ts';

  // « Montrer sur la télé » (/partager?media=…, fonction 11) : une photo ou une vidéo partagée depuis le menu Partager
  // du téléphone, déjà reçue par le serveur. Aperçu, choix de la télé (allumée ou injoignable), envoi ; la télé
  // l'affiche en plein écran (photo) ou la lit, et la ferme par Retour ou d'elle-même. Tout téléphone appairé peut
  // l'envoyer ; le serveur le vérifie. Règles : lib/share-media.ts.
  const { media }: { media: SharedMediaParam } = $props();
  const { api, navigate } = getAppContext();
  const paired = loadPairing() !== null;

  let info = $state<SharedMedia | null>(null);
  let preview = $state<string | null>(null);
  let targets = $state<ShareScreenTarget[] | null>(null);
  let chosen = $state<string | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let busy = $state(false);

  const target = $derived(targets?.find((t) => t.id === chosen) ?? null);

  async function load(id: string) {
    try {
      const [described, list] = await Promise.all([api.sharedMedia(id), api.shareTargets()]);
      info = described;
      targets = list;
      chosen = defaultTarget(list);
      preview = URL.createObjectURL(await api.sharedMediaFile(id));
    } catch (err) {
      error = (err as Error).message;
    }
  }
  // Le fichier ne change pas pendant la vie de la page : chargé une fois.
  $effect(() => {
    if (media.kind === 'error') error = media.message;
    else if (paired) void load(media.id);
  });
  onDestroy(() => {
    if (preview) URL.revokeObjectURL(preview);
  });

  async function show() {
    if (!info || !target || busy) return;
    busy = true;
    error = null;
    notice = null;
    try {
      notice = sentNotice(info.kind, (await api.sendSharedMedia(target.id, info.id)).device);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return navigate(phonePath('shopping'));
      error = (err as Error).message;
      // Une télé qui ne répond pas est peut-être éteinte : la liste est relue.
      targets = await api.shareTargets().catch(() => targets);
    } finally {
      busy = false;
    }
  }
</script>

<div class="share">
  <header>
    <button type="button" class="back" aria-label="Retour à l’appli" onclick={() => navigate(phonePath('shopping'))}><Icon name="back" size={28} strokeWidth={2.2} /></button>
    <h1>Montrer sur la télé</h1>
  </header>

  {#if !paired}
    <p class="muted">Ce téléphone n’est pas relié à HomeHub : appaire-le d’abord depuis la tablette.</p>
  {:else}
    {#if info}
      <figure class="preview">
        {#if preview && info.kind === 'photo'}
          <img src={preview} alt="Aperçu de ce qui sera montré" />
        {:else if preview}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={preview} muted playsinline controls preload="metadata"></video>
        {:else}
          <span class="placeholder"><Icon name={info.kind === 'photo' ? 'share' : 'video'} size={40} /></span>
        {/if}
        <figcaption>{info.kind === 'photo' ? 'Photo' : 'Vidéo'} · {mediaSize(info.bytes)}</figcaption>
      </figure>

      {#if targets && targets.length === 0}
        <p class="muted">Aucune télé appairée. Sur la tablette : roue dentée › Téléphones › Télés.</p>
      {:else if targets}
        <h2>Sur quelle télé ?</h2>
        <div class="targets" role="radiogroup" aria-label="Télé">
          {#each targets as t (t.id)}
            <button type="button" role="radio" aria-checked={t.id === chosen} class:on={t.id === chosen} onclick={() => (chosen = t.id)}>
              <Icon name="tv" size={26} />
              <span class="name">{t.name}</span>
              <span class="state" class:online={t.online}><span class="dot"></span>{t.online ? 'Allumée' : 'Injoignable'}</span>
            </button>
          {/each}
        </div>
        <button type="button" class="btn primary wide" disabled={!target || !target.online || busy} onclick={show}>
          <Icon name="send" size={22} />
          {busy ? 'Envoi…' : target ? `Montrer sur ${target.name}` : 'Choisis une télé'}
        </button>
        <p class="muted small">
          {info.kind === 'photo'
            ? 'La photo s’affiche en plein écran, une minute au plus ; Retour à la télécommande la ferme.'
            : 'La vidéo se lit avec son son, le programme en pause ; elle se ferme à la fin, ou par Retour à la télécommande.'}
        </p>
      {/if}
    {/if}
    <p class="feedback" role="status" class:error={error !== null} class:quiet={!(error ?? notice)}>{error ?? notice ?? ''}</p>
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
    overscroll-behavior: contain;
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

  h2 {
    margin: var(--space-2) 0 0;
    font-size: 1.1rem;
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
  }

  .preview img,
  .preview video,
  .placeholder {
    width: 100%;
    max-height: 45dvh;
    border-radius: var(--radius-md);
    background: var(--surface);
    object-fit: contain;
  }

  .placeholder {
    display: grid;
    height: 200px;
    place-items: center;
    color: var(--fg-muted);
  }

  figcaption {
    color: var(--fg-muted);
    font-size: 0.95rem;
    text-align: center;
  }

  .targets {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .targets button {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 0 16px;
    border: 2px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    text-align: left;
  }

  .targets button.on {
    border-color: var(--border-strong);
    background: var(--surface-2);
  }

  .name {
    flex: 1;
    font-weight: 600;
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-muted);
    font-size: 0.9rem;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--bad);
  }

  .state.online .dot {
    background: var(--ok);
  }

  .wide {
    display: inline-flex;
    width: 100%;
    min-height: 56px;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 1.1rem;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.9rem;
  }

  .feedback {
    margin: 0;
    padding: 12px 16px;
    border-radius: var(--radius-lg);
    background: var(--ok-bg);
    color: var(--ok-fg);
    text-align: center;
  }

  .feedback.error {
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  .feedback.quiet {
    display: none;
  }
</style>
