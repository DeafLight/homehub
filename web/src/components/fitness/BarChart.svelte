<script lang="ts">
  // Barres d'une seule série (une par semaine, par jour…). Toucher une barre affiche sa valeur sous le graphique ; au
  // départ, la dernière. Pas de légende (le titre nomme la série), grille discrète, valeurs dans le texte.
  type Props = { values: number[]; labels: string[]; max?: number; ticks?: number[]; label: string; describe: (i: number) => string };
  let { values, labels, max, ticks = [], label, describe }: Props = $props();

  const W = 320;
  const H = 120;
  const TOP = 8;
  const BOTTOM = 22;
  const GAP = 2;

  const top = $derived(Math.max(max ?? 0, ...values, ...ticks, 1));
  const step = $derived(W / Math.max(values.length, 1));
  const y = (v: number) => H - BOTTOM - (v / top) * (H - BOTTOM - TOP);
  let selected = $state<number | null>(null);
  const shown = $derived(selected ?? values.length - 1);

  /** Barre aux coins du haut arrondis (4 px), posée sur la ligne de base. */
  function bar(i: number, v: number) {
    const x = i * step + GAP / 2;
    const w = step - GAP;
    const base = H - BOTTOM;
    const h = base - y(v);
    if (h <= 0) return '';
    const r = Math.min(4, w / 2, h);
    return `M${x} ${base}V${base - h + r}Q${x} ${base - h} ${x + r} ${base - h}H${x + w - r}Q${x + w} ${base - h} ${x + w} ${base - h + r}V${base}Z`;
  }
  /** Repères en bas : première, milieu, dernière. */
  const marks = $derived(values.length > 3 ? [0, Math.floor((values.length - 1) / 2), values.length - 1] : values.map((_, i) => i));
</script>

<figure>
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={label}>
    {#each ticks as t (t)}
      <line x1="0" x2={W} y1={y(t)} y2={y(t)} class="grid" />
      <text x={W} y={y(t) - 3} class="tick" text-anchor="end">{t}</text>
    {/each}
    <line x1="0" x2={W} y1={H - BOTTOM} y2={H - BOTTOM} class="axis" />
    {#each values as v, i (i)}
      <path d={bar(i, v)} class="bar" class:on={i === shown} />
      <!-- Zone de toucher : toute la colonne, plus large que la barre. -->
      <rect
        x={i * step}
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
    {/each}
    {#each marks as i (i)}
      <text x={i * step + step / 2} y={H - 6} class="tick" text-anchor="middle">{labels[i]}</text>
    {/each}
  </svg>
  {#if values.length}<figcaption>{describe(shown)}</figcaption>{/if}
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

  .axis {
    stroke: var(--border-strong);
    stroke-width: 1;
  }

  .tick {
    fill: var(--fg-muted);
    font-size: 10px;
  }

  .bar {
    fill: var(--rain);
    opacity: 0.5;
  }

  .bar.on {
    opacity: 1;
  }

  figcaption {
    margin-top: 4px;
    color: var(--fg-muted);
    font-size: 0.9rem;
  }
</style>
