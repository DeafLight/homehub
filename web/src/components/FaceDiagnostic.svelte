<script lang="ts">
  import Avatar from './Avatar.svelte';
  import type { FaceDiagnosis } from '../../../shared/types.ts';
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import { cameraError, prepareFaces, readFace, startCamera, type FaceReading } from '../lib/face.ts';

  // Diagnostic de la reconnaissance (page Visages) : en direct, ce que voit la caméra (confiance, taille du visage),
  // les scores contre une photo ou un écran, la ressemblance avec chaque personne et le verdict, avec les seuils de
  // homehub.yaml ; puis un bilan des dernières analyses et une piste de réglage. N'ouvre aucune session.
  const TICK_MS = 500;
  /** Analyses gardées pour le bilan. */
  const HISTORY = 60;

  type Props = { onClose: () => void };
  let { onClose }: Props = $props();

  const { api, config, profiles } = getAppContext();
  const { minConfidence, minSize, backend } = config.faces;
  /** Moteur de calcul des empreintes (`faces.backend`). */
  const BACKENDS = { webgl: 'carte graphique', 'webgl-safe': 'carte graphique, mode sûr', cpu: 'processeur' } as const;

  /** Résultat d'une analyse : verdict du serveur, ou ce que la tablette a vu avant de le demander. */
  type Outcome = 'nobody' | 'blurry' | 'far' | FaceDiagnosis['verdict']['result'];

  let video = $state<HTMLVideoElement>();
  let error = $state<string | null>(null);
  let reading = $state<FaceReading | null>(null);
  let diagnosis = $state<FaceDiagnosis | null>(null);
  let outcome = $state<Outcome | null>(null);
  let history = $state<Outcome[]>([]);

  const nameOf = (id: string | null) => (id ? (profiles.find((p) => p.id === id)?.name ?? id) : '?');
  const profileOf = (id: string) => profiles.find((p) => p.id === id);
  const pct = (value: number) => `${Math.round(value * 100)} %`;
  const num = (value: number) => value.toFixed(2);
  /** Pour le CSS : sans l'espace de `pct` (« 62 % » serait ignoré). */
  const css = (value: number) => `${Math.round(value * 100)}%`;

  $effect(() => {
    if (!video) return;
    const el = video;
    let stopped = false;
    let stopCamera = () => {};
    (async () => {
      try {
        const stop = await startCamera(el);
        if (stopped) return stop();
        stopCamera = stop;
        await prepareFaces(config.faces.backend);
        while (!stopped) {
          const current = await readFace(el, minConfidence);
          if (stopped) return;
          let result: Outcome;
          let next: FaceDiagnosis | null = null;
          if (!current) result = 'nobody';
          else if (!current.embedding.length) result = 'blurry';
          else if (current.size < minSize) result = 'far';
          else {
            const { embedding, real, live } = current;
            next = await api.diagnoseFace({ embedding, real, live });
            if (stopped) return;
            result = next.verdict.result;
          }
          reading = current;
          diagnosis = next;
          outcome = result;
          // « Personne » ne compte pas dans le bilan : seules les analyses d'un visage disent si la reconnaissance marche.
          if (result !== 'nobody') history = [...history, result].slice(-HISTORY);
          await new Promise((resolve) => setTimeout(resolve, TICK_MS));
        }
      } catch (err) {
        if (!stopped) error = err instanceof ApiError ? err.message : cameraError(err);
      } finally {
        stopCamera();
      }
    })();
    return () => {
      stopped = true;
      stopCamera();
    };
  });

  function verdictText(): string {
    if (!outcome) return 'Préparation…';
    const v = diagnosis?.verdict;
    const r = diagnosis?.rules;
    switch (outcome) {
      case 'nobody':
        return 'Aucun visage devant la caméra';
      case 'blurry':
        return 'Visage vu, mais trop flou ou trop loin pour une empreinte';
      case 'far':
        return `Trop loin : visage à ${pct(reading?.size ?? 0)} de l'image, minimum ${pct(minSize)}`;
      case 'ok':
        return `Reconnu : ${nameOf(v!.ownerId)}`;
      case 'photo':
        return `Refusé : ressemble à une photo (${num(reading?.real ?? 0)} sous ${num(r!.antispoof)})`;
      case 'screen':
        return `Refusé : ressemble à un écran (${num(reading?.live ?? 0)} sous ${num(r!.liveness)})`;
      case 'none':
        return 'Aucun visage enregistré';
      case 'low':
        return `Refusé : ressemble trop peu (${nameOf(v!.ownerId)} ${num(v!.score)}, seuil ${num(r!.threshold)})`;
      case 'close':
        return `Refusé : hésite entre ${nameOf(v!.ownerId)} (${num(v!.score)}) et ${nameOf(diagnosis!.scores[1]?.ownerId ?? null)} (${num(v!.next)}), marge ${num(r!.margin)}`;
    }
  }

  const LABELS: Record<Outcome, string> = {
    ok: 'reconnu',
    nobody: 'personne',
    blurry: 'flou',
    far: 'trop loin',
    photo: 'photo ?',
    screen: 'écran ?',
    none: 'aucun enregistré',
    low: 'ressemblance faible',
    close: 'hésitation',
  };

  const counts = $derived(
    Object.entries(
      history.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o]: (acc[o] ?? 0) + 1 }), {}),
    ).sort((a, b) => b[1] - a[1]) as [Outcome, number][],
  );
  const recognized = $derived(history.length ? history.filter((o) => o === 'ok').length / history.length : 0);

  /** Piste de réglage, d'après le refus le plus fréquent du bilan. */
  const advice = $derived.by(() => {
    if (history.length < 10) return 'Reste quelques secondes devant la caméra, à ta place habituelle.';
    if (recognized >= 0.8) return 'La reconnaissance marche bien ici : rien à changer.';
    const worst = counts.find(([o]) => o !== 'ok')?.[0];
    switch (worst) {
      case 'blurry':
      case 'far':
        return 'Visage souvent trop petit : rapproche-toi, ou baisse faces.minSize dans homehub.yaml.';
      case 'photo':
      case 'screen':
        return 'Pris pour une photo ou un écran (lumière, contre-jour ?) : améliore l\'éclairage, ou baisse faces.antispoof / faces.liveness.';
      case 'low':
        return 'Ressemblance faible : « Compléter » ce visage d\'ici, avec cette lumière ; sinon baisse un peu faces.threshold.';
      case 'close':
        return 'Hésite entre deux personnes : « Compléter » les deux visages ; sinon baisse un peu faces.margin.';
      case 'none':
        return 'Enregistre d\'abord les visages.';
      default:
        return '';
    }
  });
</script>

<div class="diagnostic">
  <div class="left">
    <div class="camera" class:ok={outcome === 'ok'}>
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} muted playsinline></video>
    </div>
    <p class="verdict" class:ok={outcome === 'ok'} role="status">{error ?? verdictText()}</p>
    <button type="button" class="secondary" onclick={onClose}>Fermer</button>
  </div>

  <div class="right">
    <section>
      <h3>Détection</h3>
      <dl>
        <dt>Calcul</dt>
        <dd>{BACKENDS[backend]} <small>faces.backend {backend}</small></dd>
        <dt>Confiance</dt>
        <dd class:bad={reading !== null && reading.confidence < minConfidence}>{reading ? num(reading.confidence) : '–'} <small>min {num(minConfidence)}</small></dd>
        <dt>Taille du visage</dt>
        <dd class:bad={reading !== null && reading.size < minSize}>{reading ? pct(reading.size) : '–'} <small>min {pct(minSize)}</small></dd>
        <dt>Photo (real)</dt>
        <dd class:bad={!!diagnosis && !!reading && reading.real < diagnosis.rules.antispoof}>
          {reading ? num(reading.real) : '–'} <small>{diagnosis ? `min ${num(diagnosis.rules.antispoof)}` : ''}</small>
        </dd>
        <dt>Écran (live)</dt>
        <dd class:bad={!!diagnosis && !!reading && reading.live < diagnosis.rules.liveness}>
          {reading ? num(reading.live) : '–'} <small>{diagnosis ? `min ${num(diagnosis.rules.liveness)}` : ''}</small>
        </dd>
      </dl>
    </section>

    <section>
      <h3>Ressemblance {#if diagnosis}<small>seuil {num(diagnosis.rules.threshold)}, marge {num(diagnosis.rules.margin)}</small>{/if}</h3>
      {#if diagnosis?.scores.length}
        <ul class="scores">
          {#each diagnosis.scores as { ownerId, score } (ownerId)}
            {@const profile = profileOf(ownerId)}
            <li>
              {#if profile}<Avatar {profile} size={32} />{/if}
              <span class="who">{nameOf(ownerId)}</span>
              <span class="bar">
                <span class="fill" class:pass={score >= diagnosis.rules.threshold} style:width={css(score)}></span>
                <span class="mark" style:left={css(diagnosis.rules.threshold)}></span>
              </span>
              <span class="value">{num(score)}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">Visible quand un visage est analysé.</p>
      {/if}
    </section>

    <section>
      <h3>Bilan <small>{history.length} analyses d'un visage</small></h3>
      {#if history.length}
        <p class="summary"><strong>{pct(recognized)}</strong> reconnues</p>
        <div class="chips">
          {#each counts as [o, n] (o)}<span class="chip" class:ok={o === 'ok'}>{LABELS[o]} · {n}</span>{/each}
        </div>
      {/if}
      <p class="advice">{advice}</p>
    </section>
  </div>
</div>

<style>
  .diagnostic {
    display: flex;
    gap: 40px;
    align-items: flex-start;
  }

  .left {
    width: 300px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .camera {
    width: 280px;
    height: 280px;
    overflow: hidden;
    border: 4px solid var(--surface-2);
    border-radius: 50%;
    background: var(--bg);
  }

  .camera.ok {
    border-color: var(--ok);
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  .verdict {
    margin: 0;
    min-height: 3.2em;
    text-align: center;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--fg-soft);
  }

  .verdict.ok {
    color: var(--ok-fg);
  }

  .right {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  section {
    padding: 16px 20px;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  h3 {
    margin: 0 0 10px;
    font-size: 1.1rem;
  }

  small {
    font-size: 0.85rem;
    font-weight: 400;
    color: var(--fg-muted);
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    gap: 6px 16px;
    margin: 0;
  }

  dt {
    color: var(--fg-muted);
  }

  dd {
    margin: 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  dd.bad {
    color: var(--danger-fg);
  }

  .scores {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .scores li {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .who {
    width: 90px;
    font-weight: 600;
  }

  .bar {
    position: relative;
    flex: 1;
    height: 12px;
    border-radius: 6px;
    background: var(--surface-2);
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 6px;
    background: var(--fg-muted);
  }

  .fill.pass {
    background: var(--ok);
  }

  .mark {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    background: var(--fg);
  }

  .value {
    width: 40px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .summary {
    margin: 0 0 8px;
    font-size: 1.1rem;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 0.9rem;
  }

  .chip.ok {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }

  .advice {
    margin: 10px 0 0;
    color: var(--fg-soft);
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
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

  .secondary {
    background: var(--surface-2);
    color: var(--fg);
  }
</style>
