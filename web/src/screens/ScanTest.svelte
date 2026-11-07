<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import { normalizeProductCode, PRODUCT_FORMATS, validProductCode } from '../lib/barcode.ts';
  import { cameraError } from '../lib/face.ts';
  import { formatTime } from '../lib/format.ts';
  import type { PageRoute } from '../lib/route.ts';

  // Page provisoire (roue dentée › Test du scan) : la tablette sait-elle lire un code-barres, et la caméra passe-t-elle
  // de la reconnaissance des visages au scan sans conflit ? Rien n'est enregistré ni envoyé : le résumé en bas se
  // lit à l'écran. La reconnaissance des visages est éteinte tant que la page est ouverte (Presence.svelte).
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  type Detected = { rawValue: string; format: string };
  type Detector = { detect(source: HTMLVideoElement): Promise<Detected[]> };
  type DetectorClass = {
    new (options?: { formats: string[] }): Detector;
    getSupportedFormats(): Promise<string[]>;
  };
  const DetectorApi = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

  type Facing = 'user' | 'environment';
  type Reading = { code: string; format: string; valid: boolean; at: Date; afterMs: number };

  const DETECT_EVERY_MS = 150;
  const openedAt = performance.now();

  let video = $state<HTMLVideoElement>();
  let facing = $state<Facing>('user');
  let supported = $state<string[] | null>(null);
  let cameras = $state<{ label: string; facing: string }[]>([]);
  let cameraState = $state<'starting' | 'on' | 'error'>('starting');
  let cameraMessage = $state('');
  let startMs = $state<number | null>(null);
  let readings = $state<Reading[]>([]);
  let attempts = $state(0);

  let stopCamera: (() => void) | null = null;
  let streamStartedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  /** Change à chaque ouverture de caméra : une boucle d'analyse d'une caméra précédente s'arrête d'elle-même. */
  let generation = 0;

  async function start(which: Facing) {
    stop();
    const mine = ++generation;
    facing = which;
    cameraState = 'starting';
    cameraMessage = '';
    const t0 = performance.now();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: which, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (destroyed || !video) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      video.srcObject = stream;
      await video.play();
      stopCamera = () => {
        for (const track of stream.getTracks()) track.stop();
        if (video) video.srcObject = null;
      };
      startMs = Math.round(performance.now() - t0);
      streamStartedAt = performance.now();
      cameraState = 'on';
      const settings = stream.getVideoTracks()[0]?.getSettings();
      cameraMessage = settings ? `${settings.width} × ${settings.height}, ${settings.facingMode ?? 'sens inconnu'}` : '';
      cameras = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({ label: d.label || 'sans nom', facing: d.label.toLowerCase().includes('back') ? 'arrière' : d.label.toLowerCase().includes('front') ? 'avant' : '?' }));
      if (DetectorApi) loop(mine, new DetectorApi({ formats: [...PRODUCT_FORMATS, 'code_128', 'qr_code'].filter((f) => supported?.includes(f)) }));
    } catch (err) {
      cameraState = 'error';
      cameraMessage = (err as Error)?.name === 'NotReadableError' ? 'Caméra occupée (encore utilisée par la reconnaissance des visages ?)' : cameraError(err);
    }
  }

  function loop(mine: number, detector: Detector) {
    const tick = async () => {
      if (destroyed || mine !== generation || cameraState !== 'on' || !video) return;
      attempts++;
      try {
        for (const { rawValue, format } of await detector.detect(video)) {
          if (readings[0]?.code === rawValue && Date.now() - readings[0].at.getTime() < 2000) continue;
          readings = [
            { code: rawValue, format, valid: validProductCode(rawValue, format), at: new Date(), afterMs: Math.round(performance.now() - streamStartedAt) },
            ...readings,
          ].slice(0, 12);
        }
      } catch {
        // Image pas encore prête : on réessaie au tour suivant.
      }
      if (mine === generation) timer = setTimeout(tick, DETECT_EVERY_MS);
    };
    tick();
  }

  function stop() {
    clearTimeout(timer);
    stopCamera?.();
    stopCamera = null;
  }

  onMount(async () => {
    supported = DetectorApi ? await DetectorApi.getSupportedFormats().catch(() => []) : null;
    // La reconnaissance des visages vient de s'éteindre : on lui laisse un instant pour rendre la caméra.
    await new Promise((r) => setTimeout(r, 300));
    if (!destroyed) start('user');
  });
  onDestroy(() => {
    destroyed = true;
    stop();
  });

  const productFormats = $derived(supported?.filter((f) => (PRODUCT_FORMATS as readonly string[]).includes(f)) ?? []);
  const summary = $derived(
    [
      `HomeHub ${__APP_VERSION__}`,
      supported === null ? 'BarcodeDetector : absent' : `BarcodeDetector : oui (${productFormats.join(', ') || 'aucun format produit'})`,
      `caméra ${facing === 'user' ? 'avant' : 'arrière'} : ${cameraState === 'on' ? `ouverte en ${startMs} ms (${cameraMessage})` : cameraState === 'error' ? cameraMessage : 'en cours'}`,
      `${cameras.length} caméra(s)`,
      `lectures : ${readings.length ? readings.map((r) => `${r.code}${r.valid ? '' : ' (clé fausse)'} en ${r.afterMs} ms`).join(' ; ') : 'aucune'}`,
    ].join(' · '),
  );
</script>

<div class="scan-page">
  <header>
    <BackButton {back} />
    <h1>Test du scan</h1>
    <span class="muted">Provisoire · rien n'est enregistré</span>
  </header>

  <div class="layout">
    <div class="viewer">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} playsinline muted class:mirror={facing === 'user'}></video>
      <div class="guide" aria-hidden="true"></div>
      {#if cameraState !== 'on'}
        <div class="overlay">{cameraState === 'starting' ? 'Ouverture de la caméra…' : cameraMessage}</div>
      {/if}
      <div class="switch">
        <button type="button" class:on={facing === 'user'} onclick={() => start('user')}>Caméra avant</button>
        <button type="button" class:on={facing === 'environment'} onclick={() => start('environment')}>Caméra arrière</button>
      </div>
    </div>

    <div class="side">
      <section class="card">
        <h2>La tablette</h2>
        <dl>
          <dt>Lecteur intégré</dt>
          <dd class:bad={supported === null}>
            {supported === null ? 'Absent : il faudra une bibliothèque' : productFormats.length ? `Oui : ${productFormats.join(', ')}` : 'Présent, sans format produit'}
          </dd>
          <dt>Caméra</dt>
          <dd class:bad={cameraState === 'error'}>
            {cameraState === 'on' ? `Ouverte en ${startMs} ms · ${cameraMessage}` : cameraState === 'error' ? cameraMessage : '…'}
          </dd>
          <dt>Caméras</dt>
          <dd>{cameras.length ? cameras.map((c) => `${c.label} (${c.facing})`).join(', ') : '…'}</dd>
          <dt>Analyses</dt>
          <dd>{attempts}</dd>
        </dl>
      </section>

      <section class="card readings">
        <h2>Codes lus</h2>
        {#if readings.length === 0}
          <p class="muted">Présente un code-barres de produit devant la caméra, à 15–20 cm.</p>
        {:else}
          <ul>
            {#each readings as r (r.at.getTime())}
              <li>
                <Icon name={r.valid ? 'check' : 'alert'} size={22} />
                <span class="code">{normalizeProductCode(r.code, r.format)}</span>
                <span class="muted">{r.format} · {formatTime(r.at)} · {r.afterMs} ms</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="card">
        <h2>À me transmettre</h2>
        <p class="summary">{summary}</p>
      </section>
    </div>
  </div>
</div>

<style>
  .scan-page {
    display: flex;
    flex-direction: column;
    gap: 24px;
    height: 100vh;
    padding: 28px 40px;
    box-sizing: border-box;
  }

  header {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  h1 {
    margin: 0;
    font-size: 2.5rem;
  }

  header .muted {
    margin-left: auto;
  }

  .muted {
    color: var(--fg-muted);
  }

  .layout {
    display: grid;
    flex: 1;
    grid-template-columns: 1.2fr 1fr;
    gap: 24px;
    min-height: 0;
  }

  .viewer {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: #000;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  video.mirror {
    transform: scaleX(-1);
  }

  .guide {
    position: absolute;
    inset: 30% 15%;
    border: 3px dashed rgb(255 255 255 / 0.6);
    border-radius: 16px;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    font-size: 1.4rem;
    text-align: center;
  }

  .switch {
    position: absolute;
    bottom: 16px;
    left: 50%;
    display: flex;
    gap: 8px;
    transform: translateX(-50%);
  }

  .switch button {
    padding: 12px 20px;
    border: 0;
    border-radius: 999px;
    background: rgb(15 17 21 / 0.8);
    color: var(--fg);
    font: inherit;
    font-size: 1.1rem;
  }

  .switch button.on {
    background: var(--rain);
    color: var(--bg);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
  }

  .card {
    padding: 18px 24px;
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .card h2 {
    margin: 0 0 10px;
    font-size: 1.3rem;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 0;
    font-size: 1.05rem;
  }

  dt {
    color: var(--fg-muted);
  }

  dd {
    margin: 0;
  }

  dd.bad {
    color: var(--danger-fg);
  }

  .readings {
    flex: 1;
    overflow: auto;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
  }

  .code {
    font-size: 1.3rem;
    font-variant-numeric: tabular-nums;
  }

  .summary {
    margin: 0;
    color: var(--fg-soft);
    font-size: 0.95rem;
    line-height: 1.5;
    user-select: all;
  }
</style>
