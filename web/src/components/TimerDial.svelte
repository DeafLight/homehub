<script lang="ts">
  import { DIAL_LAP_MINUTES, dialPosition, dialTap, dialTurn, formatDuration, TIMER_MAX_MINUTES } from '../lib/timers.ts';

  // Roue du temps de la fenêtre Minuteur, comme un minuteur de cuisine : on fait glisser le doigt autour du cadran
  // (une minute par cran, un tour : une heure, autant de tours qu'on veut jusqu'à 24 h) ; l'arc coloré montre les
  // minutes du tour en cours, l'anneau pâle les heures entières ; au centre, la durée et l'heure de fin.
  type Props = { minutes: number; color: string; caption: string; size?: number };
  let { minutes = $bindable(), color, caption, size = 340 }: Props = $props();

  const C = 150;
  const R = 106;
  const point = (m: number, r: number) => {
    const a = (m / DIAL_LAP_MINUTES) * 2 * Math.PI - Math.PI / 2;
    return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
  };
  const ticks = Array.from({ length: DIAL_LAP_MINUTES }, (_, i) => {
    const major = i % 5 === 0;
    return { from: point(i, 140), to: point(i, major ? 126 : 133), major };
  });

  /** Minutes du tour en cours, et heures entières déjà faites. */
  const inLap = $derived(minutes % DIAL_LAP_MINUTES);
  const hours = $derived(Math.floor(minutes / DIAL_LAP_MINUTES));
  const knob = $derived(point(inLap, R));
  const arc = $derived.by(() => {
    if (inLap <= 0) return '';
    const start = point(0, R);
    return `M ${start.x} ${start.y} A ${R} ${R} 0 ${inLap > DIAL_LAP_MINUTES / 2 ? 1 : 0} 1 ${knob.x} ${knob.y}`;
  });

  let svg = $state<SVGSVGElement>();
  /** Position du doigt au dernier mouvement, et durée exacte (non arrondie) pendant le glisser. */
  let last: number | null = null;
  let exact = 0;

  function positionOf(event: PointerEvent) {
    const rect = svg!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 300 - C;
    const y = ((event.clientY - rect.top) / rect.height) * 300 - C;
    return dialPosition(Math.atan2(y, x) + Math.PI / 2);
  }

  function press(event: PointerEvent) {
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    last = positionOf(event);
    exact = dialTap(minutes, last);
    minutes = Math.round(exact);
  }

  function follow(event: PointerEvent) {
    if (!svg || last === null) return;
    const at = positionOf(event);
    exact = dialTurn(exact, last, at);
    last = at;
    minutes = Math.round(exact);
  }
</script>

<svg
  bind:this={svg}
  class="dial"
  viewBox="0 0 300 300"
  width={size}
  height={size}
  role="slider"
  tabindex="0"
  aria-label="Durée du minuteur"
  aria-valuemin={0}
  aria-valuemax={TIMER_MAX_MINUTES}
  aria-valuenow={minutes}
  aria-valuetext={formatDuration(minutes)}
  onpointerdown={press}
  onpointermove={follow}
  onpointerup={() => (last = null)}
  onpointercancel={() => (last = null)}
  onkeydown={(e) => {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step) minutes = Math.max(0, Math.min(TIMER_MAX_MINUTES, minutes + step));
  }}
>
  <circle cx={C} cy={C} r="146" class="face" />
  {#each ticks as tick, i (i)}
    <line x1={tick.from.x} y1={tick.from.y} x2={tick.to.x} y2={tick.to.y} class:major={tick.major} />
  {/each}
  <circle cx={C} cy={C} r={R} class="track" class:laps={hours > 0} style:stroke={hours > 0 ? color : null} />
  {#if arc}<path d={arc} class="arc" stroke={color} />{/if}
  <circle cx={knob.x} cy={knob.y} r="18" class="knob" stroke={color} />
  {#if hours > 0}
    <text x={C} y={C + 4} class="value long">{formatDuration(minutes)}</text>
    <text x={C} y={C + 34} class="unit">{hours} tour{hours > 1 ? 's' : ''} de roue</text>
  {:else}
    <text x={C} y={C + 6} class="value">{minutes}</text>
    <text x={C} y={C + 34} class="unit">{minutes > 1 ? 'minutes' : 'minute'}</text>
  {/if}
  <text x={C} y={C + 58} class="caption">{caption}</text>
</svg>

<style>
  .dial {
    touch-action: none;
    cursor: grab;
    user-select: none;
    max-width: 100%;
    height: auto;
  }

  .dial:focus {
    outline: none;
  }

  .face {
    fill: var(--bg);
    stroke: var(--surface-2);
    stroke-width: 2;
  }

  line {
    stroke: var(--surface-2);
    stroke-width: 1.5;
  }

  line.major {
    stroke: var(--off);
    stroke-width: 3;
  }

  .track {
    fill: none;
    stroke: var(--surface-2);
    stroke-width: 24;
  }

  /* Heures entières déjà faites : l'anneau entier, pâle, sous l'arc du tour en cours. */
  .track.laps {
    stroke-opacity: 0.35;
  }

  .arc {
    fill: none;
    stroke-width: 24;
    stroke-linecap: round;
  }

  .knob {
    fill: #fff;
    stroke-width: 6;
  }

  text {
    text-anchor: middle;
    font-family: inherit;
  }

  .value {
    font-size: 58px;
    font-weight: 700;
    fill: var(--fg);
    font-variant-numeric: tabular-nums;
  }

  .value.long {
    font-size: 40px;
  }

  .unit {
    font-size: 17px;
    fill: var(--fg-muted);
  }

  .caption {
    font-size: 15px;
    fill: var(--fg-muted);
  }
</style>
