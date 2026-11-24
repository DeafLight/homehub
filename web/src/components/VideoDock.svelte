<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { TabletVideo } from '../../../shared/video.ts';
  import { getAppContext } from '../lib/context.ts';
  import { loadPairing } from '../lib/phone.ts';
  import { isPhoneRoute } from '../lib/route.ts';
  import {
    clampPosition,
    cornerPosition,
    listenTabletVideo,
    loadCorner,
    MINI_VIDEO_HEIGHT,
    MINI_WIDTH,
    nearestCorner,
    type Point,
    saveCorner,
  } from '../lib/video-dock.ts';
  import { videoDock } from '../lib/video-dock.svelte.ts';
  import { loadYouTubeApi, type YouTubePlayer } from '../lib/youtube-player.ts';
  import { PLAYER_STATE, playerHost, playerVars, playingAfter } from '../lib/youtube.ts';
  import Icon from './Icon.svelte';

  // Vidéo YouTube envoyée par un téléphone (Partager → HomeHub), côté tablette. Monté dans App.svelte hors des routes :
  // la lecture continue quand on change d'écran. Elle démarre toute seule, en grand (tout l'écran moins une barre
  // HomeHub : Réduire, Pause, Fermer) ; réduite, c'est une vignette de 400 px que l'on déplace par sa barre (la vidéo
  // capte les touchers), rangée dans le coin le plus proche et retenue. Une nouvelle vidéo remplace la précédente et
  // repasse en grand. Pendant la lecture, la veille, le retour à l'accueil et les rechargements attendent
  // (lib/video-dock.svelte.ts). Lecteur : l'API IFrame de YouTube, sur le domaine de `video.host`. Rien sur un téléphone.
  const { api, actor, config, router } = getAppContext();

  /** Hauteur de la barre de la vignette (poignée et boutons). */
  const MINI_BAR = 64;
  const miniSize = { width: MINI_WIDTH, height: MINI_VIDEO_HEIGHT + MINI_BAR };

  let kiosk = $state(false);
  onMount(() => void actor.isKiosk().then((value) => (kiosk = value)));
  const listening = $derived(kiosk && !isPhoneRoute(router.route) && !loadPairing());

  $effect(() => {
    if (!listening) return;
    return listenTabletVideo({ api, onVideo: (video) => videoDock.show(video) });
  });

  // Lecteur : créé à la première vidéo, réutilisé pour les suivantes, détruit à la fermeture.
  let wrapper = $state<HTMLDivElement>();
  let player: YouTubePlayer | null = null;
  let loadedSeq = 0;
  let error = $state<string | null>(null);

  function destroyPlayer() {
    try {
      player?.destroy();
    } catch {
      // lecteur déjà parti
    }
    player = null;
    loadedSeq = 0;
  }

  async function start(video: TabletVideo, el: HTMLDivElement) {
    if (loadedSeq === video.seq) return;
    loadedSeq = video.seq;
    error = null;
    if (player) return player.loadVideoById({ videoId: video.videoId, startSeconds: video.start });
    let YT;
    try {
      YT = await loadYouTubeApi();
    } catch (err) {
      error = (err as Error).message;
      videoDock.playing = false;
      return;
    }
    const latest = videoDock.current;
    if (!latest || latest.seq !== video.seq || player) return; // fermée ou remplacée pendant le chargement
    const target = document.createElement('div');
    el.replaceChildren(target);
    player = new YT.Player(target, {
      host: playerHost(config.video.host),
      videoId: video.videoId,
      width: '100%',
      height: '100%',
      playerVars: playerVars(video.start),
      events: {
        onReady: (e) => e.target.playVideo(),
        onStateChange: (e) => {
          videoDock.playing = playingAfter(e.data, videoDock.playing);
          if (e.data === PLAYER_STATE.ended) close();
        },
        onError: () => {
          error = 'Cette vidéo ne peut pas être lue ici (privée, supprimée ou interdite hors de YouTube).';
          videoDock.playing = false;
        },
      },
    });
  }

  $effect(() => {
    const video = videoDock.current;
    const el = wrapper;
    if (!video || !el) return;
    untrack(() => void start(video, el));
  });
  $effect(() => {
    if (!videoDock.current) untrack(destroyPlayer);
  });
  onDestroy(() => {
    destroyPlayer();
    videoDock.close();
  });

  function close() {
    destroyPlayer();
    videoDock.close();
  }

  function togglePause() {
    if (!player) return;
    if (videoDock.playing) {
      player.pauseVideo();
      videoDock.playing = false;
    } else {
      player.playVideo();
      videoDock.playing = true;
    }
  }

  // Place de la vignette : dans son coin, ou sous le doigt pendant qu'on la déplace.
  let viewport = $state({ width: globalThis.innerWidth ?? 1280, height: globalThis.innerHeight ?? 800 });
  let corner = $state(loadCorner());
  let drag = $state<{ pointer: number; offset: Point; at: Point } | null>(null);
  onMount(() => {
    const resize = () => (viewport = { width: innerWidth, height: innerHeight });
    addEventListener('resize', resize);
    return () => removeEventListener('resize', resize);
  });
  const position = $derived(drag ? drag.at : cornerPosition(corner, miniSize, viewport));

  function grab(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { pointer: e.pointerId, offset: { x: e.clientX - position.x, y: e.clientY - position.y }, at: position };
  }
  function moveTo(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    drag = { ...drag, at: clampPosition({ x: e.clientX - drag.offset.x, y: e.clientY - drag.offset.y }, miniSize, viewport) };
  }
  function drop(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    corner = nearestCorner(drag.at, miniSize, viewport);
    saveCorner(corner);
    drag = null;
  }
</script>

{#if videoDock.current}
  {@const mini = videoDock.mini}
  <div
    class="dock"
    class:mini
    class:dragging={drag !== null}
    style:left={mini ? `${position.x}px` : null}
    style:top={mini ? `${position.y}px` : null}
    style:--mini-width="{MINI_WIDTH}px"
    style:--mini-video="{MINI_VIDEO_HEIGHT}px"
    style:--mini-bar="{MINI_BAR}px"
    role="region"
    aria-label="Vidéo YouTube"
  >
    <div class="video">
      <div class="player" bind:this={wrapper}></div>
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}
    </div>
    <!-- Barre HomeHub ; en vignette, c'est aussi la poignée pour la déplacer. -->
    <div class="bar" role="toolbar" tabindex="-1" aria-label="Commandes de la vidéo" onpointerdown={mini ? grab : undefined} onpointermove={moveTo} onpointerup={drop} onpointercancel={drop}>
      {#if mini}
        <span class="grip" aria-hidden="true"><Icon name="move" size={26} /></span>
        <button type="button" class="round" aria-label="Agrandir la vidéo" onclick={() => (videoDock.mini = false)}><Icon name="maximize" size={26} /></button>
        <button type="button" class="round" aria-label={videoDock.playing ? 'Mettre en pause' : 'Reprendre la lecture'} onclick={togglePause}>
          <Icon name={videoDock.playing ? 'pause' : 'play'} size={26} />
        </button>
        <button type="button" class="round" aria-label="Fermer la vidéo" onclick={close}><Icon name="close" size={26} strokeWidth={2.4} /></button>
      {:else}
        <span class="from"><Icon name="video" size={26} /> Vidéo envoyée par {videoDock.current.from}</span>
        <button type="button" class="btn big" onclick={() => (videoDock.mini = true)}><Icon name="minimize" size={28} /> Réduire</button>
        <button type="button" class="btn big" onclick={togglePause}>
          <Icon name={videoDock.playing ? 'pause' : 'play'} size={28} />
          {videoDock.playing ? 'Pause' : 'Lecture'}
        </button>
        <button type="button" class="btn big" onclick={close}><Icon name="close" size={28} strokeWidth={2.4} /> Fermer</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Au-dessus des pages et de la barre des minuteurs, sous la veille (sans effet pendant la lecture) et sous l'alerte
     d'un minuteur qui sonne. */
  .dock {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  .dock.mini {
    inset: auto;
    width: var(--mini-width);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface);
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.55);
  }

  .video {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--bg);
  }

  .mini .video {
    flex: none;
    height: var(--mini-video);
  }

  .player,
  .player :global(iframe),
  .player :global(> div) {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }

  /* Pendant le déplacement, la vidéo ne prend pas le doigt qui passe dessus. */
  .dragging .player {
    pointer-events: none;
  }

  .error {
    position: absolute;
    inset: 0;
    display: grid;
    margin: 0;
    padding: 24px;
    place-items: center;
    color: var(--fg-muted);
    font-size: var(--text-body);
    text-align: center;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 24px;
    background: var(--surface);
    border-top: 1px solid var(--border-strong);
  }

  .mini .bar {
    height: var(--mini-bar);
    box-sizing: border-box;
    gap: 8px;
    padding: 0 8px 0 4px;
    cursor: grab;
    touch-action: none;
  }

  .dragging .bar {
    cursor: grabbing;
  }

  .from {
    display: inline-flex;
    flex: 1;
    align-items: center;
    gap: 12px;
    color: var(--fg-muted);
    font-size: var(--text-body);
  }

  .big {
    display: inline-flex;
    min-height: 64px;
    align-items: center;
    gap: 10px;
    padding: 0 28px;
    font-size: 1.2rem;
  }

  .grip {
    display: grid;
    flex: 1;
    height: 100%;
    place-items: center start;
    padding-left: 14px;
    color: var(--fg-muted);
  }

  .round {
    display: grid;
    width: 52px;
    height: 52px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
  }
</style>
