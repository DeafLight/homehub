<script lang="ts">
  import type { NowPlayingView } from '../lib/now-playing.ts';
  import Icon from './Icon.svelte';

  // Carte « À l'écran » de la télécommande (fonction 18) : image du programme (sinon bannière de l'appli, sinon icône
  // télé), titre, épisode ou chaîne, appli, lecture ou pause et avancée. Règles du texte : lib/now-playing.ts.
  let { view, image = null }: { view: NowPlayingView; image?: string | null } = $props();
</script>

<section class="now" aria-label="À l’écran" aria-live="polite">
  <h2>À l’écran</h2>
  {#if view.kind === 'none'}
    <p class="muted">{view.text}</p>
  {:else}
    <div class="card">
      <div class="art">
        {#if image}<img src={image} alt="" />{:else}<Icon name="tv" size={30} />{/if}
      </div>
      <div class="info">
        {#if view.kind === 'playing'}
          <strong class="title">{view.title}</strong>
          {#if view.subtitle}<span class="subtitle">{view.subtitle}</span>{/if}
          <span class="app">
            <span class="state" class:paused={view.paused}><Icon name={view.paused ? 'pause' : 'play'} size={14} strokeWidth={2.6} /> {view.status}</span>
            · {view.app}
          </span>
        {:else}
          <strong class="title">{view.app}</strong>
          <span class="subtitle muted">{view.text}</span>
        {/if}
      </div>
    </div>
    {#if view.kind === 'playing' && view.progress !== null}
      <div class="progress" role="progressbar" aria-label="Avancée" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.progress * 100)}>
        <span style:width="{view.progress * 100}%"></span>
      </div>
      <span class="times">{view.times}</span>
    {/if}
  {/if}
</section>

<style>
  .now {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  h2 {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  p {
    margin: 0;
  }

  .card {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
    padding: 10px;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .art {
    display: grid;
    flex-shrink: 0;
    width: 112px;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--fg-muted);
  }

  .art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .info {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  .title,
  .subtitle,
  .app {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-size: 1.05rem;
  }

  .subtitle {
    color: var(--fg-soft);
    font-size: 0.9rem;
  }

  .app {
    color: var(--fg-muted);
    font-size: 0.85rem;
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ok);
    font-weight: 600;
  }

  .state.paused {
    color: var(--fg-soft);
  }

  .progress {
    height: 6px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--surface-2);
  }

  .progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--sun);
  }

  .times {
    align-self: flex-end;
    color: var(--fg-muted);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
</style>
