<script lang="ts">
  import { onDestroy } from 'svelte';
  import { filmDone, filmLabel, filmToggle } from '../../../shared/screen-film.ts';
  import type { MediaAction, MediaScreen } from '../../../shared/screen.ts';
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import { POWER_LABELS, createFeedbackTimer } from '../lib/remote.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { MEDIA_DONE, NOBODY_HINT, commander, mediaButtons, mediaHint } from '../lib/tv-media.ts';
  import Icon from './Icon.svelte';
  import PinPad from './PinPad.svelte';

  // Bouton « Télé » de la barre d'actions de l'accueil (tablette, une télé appairée au moins) et son panneau : pause,
  // reprise, volume et « À table ! » (bandeau et pause sur la télé). Un parent reconnu commande tout de suite ; sinon
  // le code parent, demandé une fois et gardé tant que le panneau reste ouvert. Volume fixe (barre de son) : pas de
  // touches de volume, et l'explication à la place. Rien de personnel : ni l'appli en cours, ni le programme.
  // « Mode film » (fonction 15) : annonces discrètes et messages vocaux sur le Google Home, mêmes règles d'accès.
  const REFRESH_MS = 60_000;

  const { api, actor } = getAppContext();
  const media = createResource(() => api.mediaScreens(), REFRESH_MS);
  onDestroy(media.destroy);

  let open = $state(false);
  let chosenId = $state<string | null>(null);
  let pin = $state<string | null>(null);
  /** Commande en attente du code parent ; `film` : le bouton Mode film (allumer ou éteindre selon l'état). */
  type Command = MediaAction | 'film';
  let asking = $state<Command | null>(null);
  let pinError = $state<string | null>(null);
  let busy = $state(false);
  let notice = $state<string | null>(null);
  let error = $state<string | null>(null);
  const feedback = createFeedbackTimer(() => ((notice = null), (error = null)));
  onDestroy(feedback.stop);

  const screens = $derived(media.data?.screens ?? []);
  const screen = $derived<MediaScreen | undefined>(screens.find((s) => s.id === chosenId) ?? screens[0]);
  const can = $derived(screen ? mediaButtons(screen) : { pause: false, volume: false });
  const hint = $derived(screen ? mediaHint(screen) : null);
  const who = $derived(commander(actor.current, media.data?.parentCode ?? false));

  function show() {
    open = true;
    void media.refresh();
  }

  function close() {
    open = false;
    pin = null;
    asking = null;
    pinError = null;
  }

  /** Envoie la commande ; avec un code refusé, le redemande. Vrai si elle est partie. */
  async function send(action: Command, code: string | null): Promise<boolean> {
    if (!screen) return false;
    busy = true;
    try {
      if (action === 'film') notice = filmDone(await api.screenFilm(screen.id, !screen.film?.on, code ?? undefined));
      else {
        await api.screenMedia(screen.id, action, code ?? undefined);
        notice = MEDIA_DONE[action];
      }
      if (code) pin = code;
      asking = null;
      error = null;
      if (action === 'film') void media.refresh();
      feedback.show('notice');
      return true;
    } catch (err) {
      const refusedCode = code !== null && err instanceof ApiError && (err.status === 403 || err.status === 429);
      if (refusedCode) {
        pin = null;
        asking = action;
        pinError = (err as Error).message;
        return false;
      }
      asking = null;
      notice = null;
      error = (err as Error).message;
      feedback.show('error');
      void media.refresh();
      return true;
    } finally {
      busy = false;
    }
  }

  function run(action: Command) {
    if (busy) return;
    if (who === 'parent') return void send(action, null);
    if (pin) return void send(action, pin);
    if (who === 'code') {
      pinError = null;
      asking = action;
      return;
    }
    error = NOBODY_HINT;
    feedback.show('error');
  }
</script>

{#if screens.length}
  <button type="button" class="action" onclick={show}>
    <Icon name="tv" size={32} />
    <span>Télé</span>
  </button>
{/if}

{#if open}
  <div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Télé">
      {#if asking}
        {@const action = asking}
        <PinPad title="Code parent" hint="Pour commander la télé" error={pinError} onSubmit={(code) => send(action, code)} onCancel={() => (asking = null)} />
      {:else}
        <header>
          <h2><Icon name="tv" size={30} /> Télé</h2>
          <button type="button" class="icon" aria-label="Fermer" onclick={close}><Icon name="close" size={28} /></button>
        </header>

        {#if screens.length > 1}
          <div class="pills">
            {#each screens as s (s.id)}
              <button type="button" class:on={s.id === screen?.id} onclick={() => (chosenId = s.id)}>{s.name}</button>
            {/each}
          </div>
        {/if}

        {#if screen}
          <p class="status {screen.power}"><span class="dot"></span>{screen.name} · {POWER_LABELS[screen.power]}</p>
          {#if hint}<p class="hint">{hint}</p>{/if}

          <div class="keys">
            <button type="button" class="key" disabled={!can.pause || busy} onclick={() => run('pause')}><Icon name="pause" size={34} /> Pause</button>
            <button type="button" class="key" disabled={!can.pause || busy} onclick={() => run('play')}><Icon name="play" size={34} /> Reprendre</button>
          </div>
          {#if screen.volume !== 'fixed'}
            <div class="keys volume">
              <button type="button" class="key" aria-label="Baisser le volume" disabled={!can.volume || busy} onclick={() => run('voldown')}><Icon name="volume" size={30} /><span class="sign">−</span></button>
              <button type="button" class="key" aria-label="Couper le son" disabled={!can.volume || busy} onclick={() => run('mute')}><Icon name="mute" size={30} /></button>
              <button type="button" class="key" aria-label="Monter le volume" disabled={!can.volume || busy} onclick={() => run('volup')}><Icon name="volume" size={30} /><span class="sign">+</span></button>
            </div>
          {/if}
          <button type="button" class="dinner" disabled={!can.pause || busy} onclick={() => run('dinner')}>À table !</button>
          {#if screen.film}
            {@const label = filmLabel(screen.film)}
            <button type="button" class="film" class:on={screen.film.on} aria-pressed={screen.film.on} disabled={!filmToggle(screen) || busy} onclick={() => run('film')}>
              <Icon name="moon" size={30} />
              {screen.film.on ? 'Mode film allumé' : 'Mode film'}
            </button>
            {#if label}<p class="film-state">{label}</p>{/if}
          {/if}
          <p class="feedback" role="status" class:error={error !== null}>{error ?? notice ?? (who === 'nobody' ? NOBODY_HINT : '')}</p>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Même facture que les autres boutons de la barre d'actions de l'accueil (Home.svelte). */
  .action {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 88px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-label);
    font-weight: 600;
    cursor: pointer;
  }

  .action:active {
    background: var(--border-strong);
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 60%);
  }

  .dialog {
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    box-sizing: border-box;
    padding: 24px 28px;
    border-radius: var(--radius-xl);
    background: var(--surface);
    color: var(--fg);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: var(--text-title);
  }

  button {
    font: inherit;
    cursor: pointer;
  }

  .icon {
    display: grid;
    width: 56px;
    height: 56px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
  }

  .pills {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .pills button {
    min-height: 48px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
  }

  .pills button.on {
    background: var(--rain-bg);
    color: var(--rain-soft);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: var(--text-body);
    color: var(--fg-soft);
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--off);
  }

  .status.on .dot {
    background: var(--ok);
  }

  .status.standby .dot {
    background: var(--warn);
  }

  .hint {
    margin: 0;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    background: var(--warn-bg);
    color: var(--fg);
    font-size: var(--text-small);
  }

  .keys {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1);
  }

  .keys.volume {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .key {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 80px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--fg);
    font-size: var(--text-body);
    font-weight: 600;
  }

  .key:active:not(:disabled) {
    background: var(--border-strong);
  }

  .key:disabled,
  .dinner:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .sign {
    font-size: 1.6rem;
    font-weight: 700;
  }

  .dinner {
    min-height: 72px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--sun);
    color: var(--bg);
    font-size: var(--text-title);
    font-weight: 800;
  }

  .film {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 72px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--fg);
    font-size: var(--text-body);
    font-weight: 700;
  }

  .film.on {
    background: var(--rain-bg);
    color: var(--rain-soft);
  }

  .film:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .film-state {
    margin: 0;
    color: var(--fg-soft);
    font-size: var(--text-small);
    text-align: center;
  }

  .feedback {
    min-height: 1.5em;
    margin: 0;
    color: var(--ok-fg);
    font-size: var(--text-small);
    text-align: center;
  }

  .feedback.error {
    color: var(--danger-fg);
  }
</style>
