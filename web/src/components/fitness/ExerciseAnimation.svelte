<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { cycleSeconds, frameOf, LEN, MOVES, place, poseAt, type Pt } from '../../../../shared/fitness-moves.ts';

  // Animation d'un exercice : le bonhomme passe en boucle par les positions clés. `still` : première position seule
  // (vignette du catalogue). Lecture, pause et ralenti ; à l'arrêt d'office si le système demande moins d'animations.
  // Sans `controls` (séance guidée), ni boutons ni ralenti : `paused` vient de la séance.
  type Props = { id: string; still?: boolean; height?: number; label?: string; controls?: boolean; paused?: boolean };
  let { id, still = false, height = 200, label, controls = true, paused = false }: Props = $props();

  const move = $derived(MOVES[id]);
  const frame = $derived(move ? frameOf(move) : null);
  const cycle = $derived(move ? cycleSeconds(move) : 0);

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let playing = $state(untrack(() => !still && !reduced));
  let slow = $state(false);
  let time = $state(0);

  let last: number | null = null;
  let raf = 0;
  function tick(now: number) {
    if (last !== null) time += ((now - last) / 1000) * (slow ? 0.4 : 1);
    last = now;
    raf = requestAnimationFrame(tick);
  }
  $effect(() => {
    if (!playing || paused || !cycle) return;
    last = null;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
  onDestroy(() => cancelAnimationFrame(raf));

  const figure = $derived(move ? place(move, still ? move.poses[0] : poseAt(move, time)) : null);
  const far = $derived(move?.view === 'side' ? 'var(--fg-muted)' : 'var(--fg)');
  const seg = (a: Pt, b: Pt) => `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
</script>

{#if move && frame && figure}
  <div class="anim" class:still>
    <svg
      viewBox="{frame.x} {frame.y} {frame.w} {frame.h}"
      style:height="{height}px"
      role="img"
      aria-label={label ?? 'Animation de l’exercice'}
    >
      <line x1={frame.x} x2={frame.x + frame.w} y1="0.5" y2="0.5" class="ground" />
      {#each move.props ?? [] as p, i (i)}
        {#if p.kind === 'block'}
          <rect x={p.x} y={-p.h} width={p.w} height={p.h} rx="1.5" class="prop" />
        {:else if p.kind === 'wall' || p.kind === 'door'}
          <rect x={p.x} y={frame.y} width="5" height={-frame.y} class="prop" />
          {#if p.kind === 'door'}
            <circle cx={p.x} cy={-p.handle} r="1.8" class="handle" />
            <path d={seg(figure.arms[0][1], [p.x, -p.handle])} class="towel" />
          {/if}
        {:else if p.kind === 'chair'}
          <path
            d="M{p.x - 10} {-p.h}H{p.x + 10}M{p.x - 9} {-p.h}V0M{p.x + 9} {-p.h}V0M{p.x + 10 * p.back} {-p.h}V{-p.h - 22}"
            class="frame"
          />
        {:else if p.kind === 'table'}
          <path d="M{p.x1} {-p.h}H{p.x2}M{p.x2 - 2} {-p.h}V0" class="frame" />
        {/if}
      {/each}
      <g stroke={far}>
        <path d={seg(figure.neck, figure.arms[1][0]) + seg(figure.arms[1][0], figure.arms[1][1])} class="limb" />
        <path d={seg(figure.hip, figure.legs[1][0]) + seg(figure.legs[1][0], figure.legs[1][1])} class="limb leg" />
        <path d={seg(figure.legs[1][1], figure.legs[1][2])} class="limb foot" />
      </g>
      <g stroke="var(--fg)">
        <path d={seg(figure.hip, figure.neck)} class="torso" />
        <circle cx={figure.head[0]} cy={figure.head[1]} r={LEN.head} fill="var(--fg)" stroke="none" />
        <path d={seg(figure.hip, figure.legs[0][0]) + seg(figure.legs[0][0], figure.legs[0][1])} class="limb leg" />
        <path d={seg(figure.legs[0][1], figure.legs[0][2])} class="limb foot" />
        <path d={seg(figure.neck, figure.arms[0][0]) + seg(figure.arms[0][0], figure.arms[0][1])} class="limb" />
      </g>
    </svg>
    {#if !still && cycle && controls}
      <div class="controls">
        <button type="button" onclick={() => (playing = !playing)} aria-pressed={playing}>{playing ? 'Pause' : 'Lecture'}</button>
        <button type="button" class:on={slow} onclick={() => (slow = !slow)} aria-pressed={slow}>Ralenti</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .anim {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 8px 10px;
    border-radius: 18px;
    background: var(--surface);
  }

  .anim.still {
    padding: 0;
    background: none;
  }

  svg {
    display: block;
    max-width: 100%;
    overflow: visible;
  }

  .ground {
    stroke: var(--border-strong);
    stroke-width: 1;
  }

  .prop {
    fill: var(--surface-2);
    stroke: var(--border-strong);
    stroke-width: 0.8;
  }

  .frame {
    fill: none;
    stroke: var(--fg-muted);
    stroke-width: 2.4;
    stroke-linecap: round;
  }

  .handle {
    fill: var(--fg-muted);
  }

  .towel {
    stroke: var(--sun);
    stroke-width: 1.8;
  }

  path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .torso {
    stroke-width: 6.5;
  }

  .limb {
    stroke-width: 4.2;
  }

  .leg {
    stroke-width: 4.8;
  }

  .foot {
    stroke-width: 3.6;
  }

  .controls {
    display: flex;
    gap: 8px;
  }

  .controls button {
    min-height: 40px;
    padding: 0 16px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }

  .controls button.on {
    border-color: var(--rain);
    background: var(--rain);
    color: var(--bg);
  }
</style>
