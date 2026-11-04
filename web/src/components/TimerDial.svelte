<script lang="ts">
  import { DIAL_MAX_MINUTES, dialMinutes } from '../lib/timers.ts';

  // Roue du temps de la fenêtre Minuteur, comme un minuteur de cuisine : on fait glisser le doigt autour du cadran
  // (une minute par cran, un tour : une heure) ; l'arc coloré montre la durée, le centre les minutes et l'heure de fin.
  type Props = { minutes: number; color: string; caption: string; size?: number };
  let { minutes = $bindable(), color, caption, size = 340 }: Props = $props();

  const C = 150;
  const R = 106;
  const point = (m: number, r: number) => {
    const a = (m / DIAL_MAX_MINUTES) * 2 * Math.PI - Math.PI / 2;
    return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
  };
  const ticks = Array.from({ length: DIAL_MAX_MINUTES }, (_, i) => {
    const major = i % 5 === 0;
    return { from: point(i, 140), to: point(i, major ? 126 : 133), major };
  });

  const knob = $derived(point(Math.min(minutes, DIAL_MAX_MINUTES - 0.01), R));
  const arc = $derived.by(() => {
    if (minutes <= 0) return '';
    if (minutes >= DIAL_MAX_MINUTES) return `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R}`;
    const start = point(0, R);
    return `M ${start.x} ${start.y} A ${R} ${R} 0 ${minutes > DIAL_MAX_MINUTES / 2 ? 1 : 0} 1 ${knob.x} ${knob.y}`;
  });

  let svg = $state<SVGSVGElement>();
  let dragging = false;

  function follow(event: PointerEvent) {
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 300 - C;
    const y = ((event.clientY - rect.top) / rect.height) * 300 - C;
    minutes = dialMinutes(Math.atan2(y, x) + Math.PI / 2, minutes);
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
  aria-valuemax={DIAL_MAX_MINUTES}
  aria-valuenow={minutes}
  aria-valuetext="{minutes} minutes"
  onpointerdown={(e) => {
    dragging = true;
    svg?.setPointerCapture(e.pointerId);
    follow(e);
  }}
  onpointermove={(e) => dragging && follow(e)}
  onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)}
  onkeydown={(e) => {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step) minutes = Math.max(0, Math.min(DIAL_MAX_MINUTES, minutes + step));
  }}
>
  <circle cx={C} cy={C} r="146" class="face" />
  {#each ticks as tick, i (i)}
    <line x1={tick.from.x} y1={tick.from.y} x2={tick.to.x} y2={tick.to.y} class:major={tick.major} />
  {/each}
  <circle cx={C} cy={C} r={R} class="track" />
  {#if arc}<path d={arc} class="arc" stroke={color} />{/if}
  <circle cx={knob.x} cy={knob.y} r="18" class="knob" stroke={color} />
  <text x={C} y={C + 6} class="value">{minutes}</text>
  <text x={C} y={C + 34} class="unit">{minutes > 1 ? 'minutes' : 'minute'}</text>
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

  .unit {
    font-size: 17px;
    fill: var(--fg-muted);
  }

  .caption {
    font-size: 15px;
    fill: var(--fg-muted);
  }
</style>
