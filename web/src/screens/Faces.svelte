<script lang="ts">
  import { onDestroy } from 'svelte';
  import Avatar from '../components/Avatar.svelte';
  import BackButton from '../components/BackButton.svelte';
  import FaceDiagnostic from '../components/FaceDiagnostic.svelte';
  import PinPad from '../components/PinPad.svelte';
  import { looksUniform, UNIFORM_MESSAGE } from '../../../shared/faces.ts';
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import { cameraError, prepareFaces, readFace, startCamera } from '../lib/face.ts';
  import type { Profile } from '../lib/profiles.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import type { PageRoute } from '../lib/route.ts';

  // Visages de la famille, ouverts depuis la roue dentée (tablette seulement) : chacun se place devant la caméra, à sa
  // place habituelle, le temps de quelques prises (guidées : ni trop loin, ni trop près), puis un parent valide avec le
  // code parent (scripts/set-pin.ts --parent). Seules les empreintes des visages sont gardées, sur le serveur ; aucune
  // photo. Le diagnostic montre en direct pourquoi un visage est reconnu ou non, pour régler les seuils. Des prises
  // presque identiques (tablette qui calcule mal les empreintes) ne sont pas enregistrées, et un profil déjà touché
  // est signalé, à effacer et refaire.
  const SAMPLES = 10;
  const PAUSE_MS = 400;
  /** Largeur du visage acceptée, en part de l'image : en dehors, on guide (« approche-toi », « recule un peu »). */
  const MIN_SIZE = 0.18;
  const MAX_SIZE = 0.6;

  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, config, profiles } = getAppContext();
  const me = createResource(() => api.me(), 60_000);
  const faces = createResource(() => api.faces(), 60_000);
  onDestroy(() => {
    me.destroy();
    faces.destroy();
  });

  const members = profiles.filter((p) => !p.isFamily);
  const isParent = (id: string) => config.members.find((m) => m.id === id)?.parent ?? false;
  const samplesText = (count: { enrolled: number; learned: number } | undefined) =>
    !count ? '' : ` (${count.enrolled} prises${count.learned ? `, ${count.learned} apprise${count.learned > 1 ? 's' : ''}` : ''})`;

  /** Prises en cours pour ce profil, puis code parent ; ou effacement (code parent). */
  let capturing = $state<Profile | null>(null);
  let samples = $state<number[][]>([]);
  let erasing = $state<Profile | null>(null);
  let diagnosing = $state(false);
  let message = $state<string | null>(null);
  let pinError = $state<string | null>(null);
  let video = $state<HTMLVideoElement>();

  const ready = $derived(samples.length >= SAMPLES);
  /** Prises terminées mais anormalement uniformes : refusées avant même le code parent (le serveur les refuse aussi). */
  const uniform = $derived(ready && looksUniform(samples));

  $effect(() => {
    if (!video || !capturing) return;
    const el = video;
    let stopped = false;
    let stopCamera = () => {};
    (async () => {
      try {
        const stop = await startCamera(el);
        if (stopped) return stop();
        stopCamera = stop;
        message = 'Préparation…';
        await prepareFaces(config.faces.backend);
        while (!stopped && samples.length < SAMPLES) {
          const reading = await readFace(el, config.faces.minConfidence);
          if (stopped) return;
          if (!reading?.embedding.length) message = 'Regarde la tablette';
          else if (reading.size < MIN_SIZE) message = 'Approche-toi';
          else if (reading.size > MAX_SIZE) message = 'Recule un peu';
          else {
            message = 'Tourne un peu la tête, doucement';
            samples = [...samples, reading.embedding];
          }
          await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
        }
      } catch (err) {
        if (!stopped) message = cameraError(err);
      } finally {
        stopCamera();
      }
    })();
    return () => {
      stopped = true;
      stopCamera();
    };
  });

  function start(profile: Profile) {
    samples = [];
    message = null;
    pinError = null;
    capturing = profile;
  }

  function close() {
    capturing = null;
    erasing = null;
    samples = [];
    pinError = null;
  }

  /** Code parent refusé : on le redemande (false) ; autre refus : affiché, la saisie reste ouverte. */
  async function withParentCode(action: () => Promise<void>): Promise<boolean> {
    pinError = null;
    try {
      await action();
      close();
      await faces.refresh();
      return true;
    } catch (err) {
      pinError = err instanceof ApiError ? err.message : (err as Error).message;
      return false;
    }
  }
</script>

<div class="faces-page">
  <header>
    <BackButton {back} />
    <h1>Visages</h1>
  </header>

  {#if !me.data?.kiosk}
    {#if me.data}<p class="muted">Réservé à la tablette.</p>{/if}
  {:else if diagnosing}
    <FaceDiagnostic onClose={() => (diagnosing = false)} />
  {:else if capturing && uniform}
    {@const profile = capturing}
    <div class="capture">
      <h2>{profile.name}</h2>
      <p class="status error" role="alert">{UNIFORM_MESSAGE}</p>
      <p class="muted">Ces prises ne sont pas enregistrées.</p>
      <div class="actions">
        <button type="button" class="primary" onclick={() => start(profile)}>Recommencer</button>
        <button type="button" class="secondary" onclick={close}>Annuler</button>
      </div>
    </div>
  {:else if capturing && ready}
    {@const profile = capturing}
    <PinPad
      {profile}
      title="Visage de {profile.name}"
      hint="Code parent"
      error={pinError}
      onSubmit={(pin) => withParentCode(() => api.enrollFace(profile.id, samples, pin))}
      onCancel={close}
    />
  {:else if capturing}
    <div class="capture">
      <h2>{capturing.name}</h2>
      <div class="camera">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={video} muted playsinline></video>
      </div>
      <div class="progress" aria-label="{samples.length} prises sur {SAMPLES}">
        {#each Array.from({ length: SAMPLES }, (_, i) => i) as i (i)}
          <span class:done={i < samples.length}></span>
        {/each}
      </div>
      {#if message}<p class="status">{message}</p>{/if}
      <button type="button" class="secondary" onclick={close}>Annuler</button>
    </div>
  {:else if erasing}
    {@const profile = erasing}
    <PinPad
      {profile}
      title="Effacer le visage de {profile.name}"
      hint="Code parent"
      error={pinError}
      onSubmit={(pin) => withParentCode(() => api.removeFace(profile.id, pin))}
      onCancel={close}
    />
  {:else}
    <p class="muted intro">
      Sur la tablette, chacun est reconnu à son visage avant de modifier quelque chose. Un parent modifie tous les
      profils ; un enfant, seulement le sien. Les autres profils restent lisibles par tous.
    </p>
    <ul class="members">
      {#each members as profile (profile.id)}
        {@const enrolled = faces.data?.enrolled.includes(profile.id) ?? false}
        {@const count = faces.data?.samples?.[profile.id]}
        <li>
          <Avatar {profile} size={56} />
          <div class="who">
            <span class="name">{profile.name}</span>
            <span class="muted">{isParent(profile.id) ? 'Parent' : 'Enfant'} · {enrolled ? `visage enregistré${samplesText(count)}` : 'pas encore de visage'}</span>
            {#if count?.uniform}<span class="warn">Prises anormales : efface et refais ce visage</span>{/if}
          </div>
          <button type="button" class="primary" onclick={() => start(profile)}>{enrolled ? 'Compléter' : 'Enregistrer'}</button>
          {#if enrolled}
            <button type="button" class="secondary" onclick={() => ((erasing = profile), (pinError = null))}>Effacer</button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if faces.data?.enrolled.length}
      <div class="tools">
        <button type="button" class="secondary" onclick={() => (diagnosing = true)}>Diagnostic</button>
        <span class="muted">Pourquoi un visage est reconnu ou non, en direct, avec des pistes de réglage.</span>
      </div>
    {/if}
    {#if faces.error}<p class="error">{faces.error}</p>{/if}
  {/if}
</div>

<style>
  .faces-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 28px 40px 36px;
    box-sizing: border-box;
    overflow-y: auto;
  }

  header {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  h1 {
    margin: 0;
    font-size: 2.5rem;
    font-weight: 600;
  }

  h2 {
    margin: 0;
    font-size: 1.8rem;
  }

  .muted {
    color: var(--fg-muted);
  }

  .intro {
    max-width: 760px;
    margin: 0;
    font-size: 1.15rem;
  }

  .members {
    max-width: 760px;
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .members li {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--surface-2);
  }

  .members li:last-child {
    border-bottom: 0;
  }

  .who {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .name {
    font-size: 1.3rem;
    font-weight: 600;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 16px;
    max-width: 760px;
  }

  .capture {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
  }

  .camera {
    width: 320px;
    height: 320px;
    overflow: hidden;
    border: 4px solid var(--rain);
    border-radius: 50%;
    background: var(--bg);
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  .progress {
    display: flex;
    gap: 10px;
  }

  .progress span {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--surface-2);
  }

  .progress span.done {
    background: var(--rain);
  }

  .status {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
  }

  .error {
    color: var(--danger-fg);
  }

  .warn {
    color: var(--warn);
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: 12px;
  }

  button {
    min-height: 52px;
    padding: 0 22px;
    border: 0;
    border-radius: 16px;
    font: inherit;
    font-size: 1.05rem;
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
