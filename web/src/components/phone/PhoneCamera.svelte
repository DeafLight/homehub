<script lang="ts">
  import { onMount } from 'svelte';
  import type { Api } from '../../lib/api.ts';
  import type { CastDevice } from '../../../../shared/types.ts';
  import { createLiveViewer, type LiveViewer, type ViewerState } from '../../lib/live-camera.ts';
  import { createVoiceRecorder, VOICE_MAX_SECONDS, type VoiceState } from '../../lib/voice-message.ts';
  import Icon from '../Icon.svelte';

  // Onglet Caméra (parents) : la caméra de face de la tablette en direct, avec le son. La diffusion démarre à
  // l'ouverture de l'onglet et s'arrête en le quittant ou quand la page est masquée (écran éteint, autre appli) ;
  // elle reprend au retour sur la page. La tablette affiche un bandeau tant qu'on regarde (sauf réglage contraire).
  // Bouton Parler (si `camera.talk`) : le micro part vers la tablette, qui sonne puis joue la voix et affiche « Alex
  // parle » ; pendant ce temps le son de la tablette est coupé ici (pas d'écho), il revient en arrêtant.
  // Destination du micro (s'il y a des appareils Cast, `cast` dans homehub.yaml) : la tablette, en direct, ou un
  // Google Home, une télé : message enregistré (un appui pour commencer, un pour envoyer), lu une ou deux secondes après.
  type Props = { api: Api; bannerShown: boolean; castDevices?: CastDevice[] };
  let { api, bannerShown, castDevices = [] }: Props = $props();

  const TABLET = 'tablet';
  let target = $state(TABLET);
  let voice = $state<VoiceState>({ phase: 'idle' });
  const recorder = createVoiceRecorder({ api: { sendVoice: (device, audio) => api.sendVoice(device, audio) }, onState: (s) => (voice = s) });
  const recording = $derived(voice.phase === 'recording');
  const targetDevice = $derived(castDevices.find((d) => d.id === target) ?? null);

  let view = $state<ViewerState>({ phase: 'connecting' });
  let stream = $state<MediaStream | null>(null);
  let video = $state<HTMLVideoElement>();
  let muted = $state(false);
  let talkBusy = $state(false);
  let talkError = $state<string | null>(null);
  let viewer: LiveViewer | null = null;

  const talking = $derived(view.phase === 'live' && view.talking);
  const locked = $derived(talking || talkBusy || recording || voice.phase === 'sending');

  function choose(id: string) {
    if (locked) return;
    target = id;
    voice = { phase: 'idle' };
  }

  async function toggleTalk() {
    if (!viewer || talkBusy) return;
    talkBusy = true;
    talkError = null;
    try {
      await viewer.talk(!talking);
    } catch (err) {
      talkError = (err as Error).message;
    } finally {
      talkBusy = false;
    }
  }

  function start() {
    viewer?.stop();
    talkError = null;
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
      recorder.cancel();
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
    <video bind:this={video} autoplay playsinline muted={muted || recording} class:hidden={view.phase !== 'live'}></video>
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
        <button type="button" class="btn sound" aria-pressed={!muted} disabled={talking} onclick={() => (muted = !muted)}>
          <Icon name={muted || talking ? 'mute' : 'volume'} size={22} />
          {talking ? 'Son coupé' : muted ? 'Activer le son' : 'Couper le son'}
        </button>
      {/if}
    </div>
  {/if}

  {#if castDevices.length > 0}
    <div class="dest" role="radiogroup" aria-label="Où part ta voix">
      <span class="dest-label">Ta voix sur</span>
      {#each [{ id: TABLET, name: 'Tablette', icon: 'tablet' as const }, ...castDevices.map((d) => ({ id: d.id, name: d.name, icon: d.kind === 'tv' ? ('tv' as const) : ('speaker' as const) }))] as option (option.id)}
        <button type="button" role="radio" class="chip" aria-checked={target === option.id} disabled={locked && target !== option.id} onclick={() => choose(option.id)}>
          <Icon name={option.icon} size={20} />
          {option.name}
        </button>
      {/each}
    </div>
  {/if}

  {#if targetDevice}
    {#if voice.phase === 'recording'}
      <div class="row">
        <button type="button" class="btn talk on grow" onclick={() => recorder.finish()}>
          <Icon name="send" size={22} /> Envoyer
        </button>
        <button type="button" class="btn" onclick={() => recorder.cancel()}>Annuler</button>
      </div>
      <p class="talking" role="status"><span class="rec-dot" aria-hidden="true"></span> Enregistrement… Appuie sur Envoyer quand tu as fini (envoi automatique au bout de {VOICE_MAX_SECONDS} secondes).</p>
    {:else}
      <button type="button" class="btn talk" disabled={voice.phase === 'sending'} onclick={() => recorder.start(targetDevice.id)}>
        <Icon name="mic" size={24} />
        {voice.phase === 'sending' ? 'Envoi…' : 'Enregistrer un message'}
      </button>
      {#if voice.phase === 'sent'}
        <p class="talking" role="status">Message lu sur {voice.device}.</p>
      {:else if voice.phase === 'error'}
        <p class="error" role="alert">{voice.message}</p>
      {:else}
        <p class="talking">{targetDevice.name} lit ton message une ou deux secondes après l’envoi{targetDevice.kind === 'tv' ? ', par-dessus ce que montre la télé' : ' (la musique en cours s’arrête)'}.</p>
      {/if}
    {/if}
  {:else if view.phase === 'live' && view.talk}
    <button type="button" class="btn talk" class:on={talking} aria-pressed={talking} disabled={talkBusy} onclick={toggleTalk}>
      <Icon name="mic" size={24} />
      {talking ? 'Arrêter de parler' : 'Parler'}
    </button>
    {#if talking}
      <p class="talking" role="status">La tablette sonne puis diffuse ta voix, avec ton prénom en haut de l’écran. Le son de la tablette est coupé ici pendant ce temps.</p>
    {/if}
    {#if talkError}<p class="error" role="alert">{talkError}</p>{/if}
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

  .sound:disabled {
    opacity: 0.6;
  }

  .talk {
    justify-content: center;
    padding: 14px 18px;
    font-weight: 600;
  }

  .talk.on {
    border-color: var(--danger-fg);
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  .talking {
    margin: 0;
    color: var(--fg-muted);
  }

  .dest {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .dest-label {
    color: var(--fg-muted);
    font-size: 0.95rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--fg-muted);
    font: inherit;
  }

  .chip[aria-checked='true'] {
    border-color: var(--rain);
    background: var(--surface-2);
    color: var(--fg);
    font-weight: 600;
  }

  .chip:disabled {
    opacity: 0.5;
  }

  .row {
    display: flex;
    gap: var(--space-2);
  }

  .grow {
    flex: 1;
  }

  .rec-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 4px;
    border-radius: 50%;
    background: var(--bad);
  }

  p.error {
    margin: 0;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.95rem;
  }
</style>
