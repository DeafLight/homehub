<script lang="ts">
  import type { WeatherHour } from '../../../../shared/types.ts';
  import { formatTemperature, hourlyPoints } from '../../lib/weather.ts';

  // Prochaines 24 h : courbe de température (toutes les heures), étiquetée toutes les 3 h,
  // et barres de pluie cumulée par tranche de 3 h. Dessinée à la largeur réelle du bloc.
  type Props = { hours: WeatherHour[] };
  let { hours }: Props = $props();

  const HEIGHT = 230;
  const PAD_X = 36;
  const CURVE_TOP = 64;
  const CURVE_BOTTOM = 140;
  const BAR_BOTTOM = 196;
  const BAR_MAX = 36;
  /** Échelle minimale des barres : une petite bruine ne remplit pas tout le bloc. */
  const RAIN_SCALE_MM = 2;

  const mmFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

  let width = $state(0);

  const points = $derived(hourlyPoints(hours));
  const temps = $derived(hours.map((h) => h.temperatureC));
  const tMin = $derived(Math.min(...temps));
  const tMax = $derived(Math.max(...temps));
  const rainScale = $derived(Math.max(RAIN_SCALE_MM, ...points.map((p) => p.rainMm)));

  const x = (hourIndex: number) => PAD_X + (hourIndex / Math.max(hours.length - 1, 1)) * (width - 2 * PAD_X);
  const y = (t: number) => (tMax === tMin ? (CURVE_TOP + CURVE_BOTTOM) / 2 : CURVE_BOTTOM - ((t - tMin) / (tMax - tMin)) * (CURVE_BOTTOM - CURVE_TOP));
  const barHeight = (mm: number) => (mm < 0.05 ? 0 : Math.max(4, (mm / rainScale) * BAR_MAX));

  const curve = $derived(hours.map((h, i) => `${x(i)},${y(h.temperatureC)}`).join(' '));
</script>

<div class="chart" bind:clientWidth={width}>
  {#if width > 0 && hours.length > 1}
    <svg {width} height={HEIGHT} aria-hidden="true">
      <polyline points={curve} fill="none" stroke="var(--sun)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
      {#each points as point, i (point.time.getTime())}
        {@const cx = x(i * 3)}
        {@const cy = y(point.temperatureC)}
        {@const bar = barHeight(point.rainMm)}
        <text x={cx} y={cy - 16} class="temp">{formatTemperature(point.temperatureC)}</text>
        <circle {cx} {cy} r="5" class="dot" />
        {#if bar > 0}
          <!-- La barre couvre la tranche qui suit le point : centrée entre lui et le suivant. -->
          {@const bx = x(i * 3 + 1.5)}
          <rect x={bx - 12} y={BAR_BOTTOM - bar} width="24" height={bar} rx="5" class="bar" />
          <text x={bx} y={BAR_BOTTOM - bar - 6} class="rain">{mmFormat.format(point.rainMm)}</text>
        {/if}
        <text x={cx} y={HEIGHT - 6} class="time" class:now={i === 0}>{i === 0 ? 'Maint.' : `${point.time.getHours()} h`}</text>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .chart {
    height: 230px;
  }

  text {
    text-anchor: middle;
    fill: var(--fg-muted);
    font-size: 16px;
  }

  .temp {
    fill: var(--fg);
    font-size: 18px;
    font-weight: 600;
  }

  .dot {
    fill: var(--bg);
    stroke: var(--sun);
    stroke-width: 3;
  }

  .bar {
    fill: var(--rain);
  }

  .rain {
    fill: var(--rain-soft);
    font-size: 14px;
  }

  .time.now {
    fill: var(--fg);
    font-weight: 700;
  }
</style>
