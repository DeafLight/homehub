<script lang="ts">
  // Courbe d'une seule série, interrompue là où il n'y a pas de valeur (semaine sans séance). Toucher un point affiche
  // sa valeur sous le graphique ; au départ, le dernier. `marks` : repères verticaux annotés (changement de palier).
  type Props = {
    values: (number | null)[];
    labels: string[];
    min: number;
    max: number;
    ticks?: number[];
    marks?: { index: number; text: string }[];
    label: string;
    describe: (i: number) => string;
  };
  let { values, labels, min, max, ticks = [], marks = [], label, describe }: Props = $props();

  const W = 320;
  const H = 120;
  const TOP = 14;
  const BOTTOM = 22;

  const step = $derived(values.length > 1 ? W / (values.length - 1) : W);
  const x = (i: number) => (values.length > 1 ? i * step : W / 2);
  const y = (v: number) => H - BOTTOM - ((v - min) / (max - min || 1)) * (H - BOTTOM - TOP);

  /** Segments continus (une semaine vide coupe la courbe). */
  const segments = $derived.by(() => {
    const out: string[] = [];
    let current: string[] = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (current.length) out.push(current.join(' '));
        current = [];
      } else current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    if (current.length) out.push(current.join(' '));
    return out;
  });

  const last = $derived(values.reduce<number>((found, v, i) => (v === null ? found : i), -1));
  let selected = $state<number | null>(null);
  const shown = $derived(selected ?? last);
  const axisMarks = $derived(values.length > 3 ? [0, Math.floor((values.length - 1) / 2), values.length - 1] : values.map((_, i) => i));
</script>

<figure>
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={label}>
    {#each ticks as t (t)}
      <line x1="0" x2={W} y1={y(t)} y2={y(t)} class="grid" />
      <text x="0" y={y(t) - 3} class="tick">{t}</text>
    {/each}
    {#each marks as m (m.index)}
      <line x1={x(m.index)} x2={x(m.index)} y1={TOP - 4} y2={H - BOTTOM} class="mark" />
      <text x={x(m.index) + 3} y={TOP - 4} class="tick">{m.text}</text>
    {/each}
    {#each segments as points (points)}
      {#if points.includes(' ')}
        <polyline {points} class="line" />
      {/if}
    {/each}
    {#each values as v, i (i)}
      {#if v !== null}
        <circle cx={x(i)} cy={y(v)} r={i === shown ? 5 : 3.5} class="dot" class:on={i === shown} />
        <rect
          x={x(i) - step / 2}
          y="0"
          width={step}
          height={H}
          fill="transparent"
          role="button"
          tabindex="-1"
          aria-label={describe(i)}
          onclick={() => (selected = i)}
          onkeydown={() => (selected = i)}
        />
      {/if}
    {/each}
    {#each axisMarks as i (i)}
      <text x={x(i)} y={H - 6} class="tick" text-anchor={i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'}>{labels[i]}</text>
    {/each}
  </svg>
  {#if shown >= 0}<figcaption>{describe(shown)}</figcaption>{/if}
</figure>

<style>
  figure {
    margin: 0;
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }

  .grid {
    stroke: var(--surface-2);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }

  .mark {
    stroke: var(--border-strong);
    stroke-width: 1;
  }

  .tick {
    fill: var(--fg-muted);
    font-size: 10px;
  }

  .line {
    fill: none;
    stroke: var(--rain);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .dot {
    fill: var(--rain);
    stroke: var(--surface);
    stroke-width: 2;
  }

  figcaption {
    margin-top: 4px;
    color: var(--fg-muted);
    font-size: 0.9rem;
  }
</style>
