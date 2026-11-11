<script lang="ts">
  import { onDestroy } from 'svelte';
  import Card from '../components/Card.svelte';
  import Icon from '../components/Icon.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import HourlyChart from '../components/widgets/HourlyChart.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { formatDay, formatTime } from '../lib/format.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import type { PageRoute } from '../lib/route.ts';
  import {
    dayExtra,
    firstRainSpell,
    formatHour,
    formatMm,
    formatTemperature,
    humidityLabel,
    rainLine,
    weatherIcon,
    weatherIconColor,
    weatherLabel,
    windDirection,
  } from '../lib/weather.ts';

  const WEATHER_REFRESH_MS = 10 * 60_000;

  // Page météo détaillée (piste A, docs/design.md) : le temps actuel en grand, quatre cartes (vent, humidité, soleil,
  // pluie), les 24 prochaines heures et les jours suivants. `back` est la page qui l'a ouverte (accueil ou profil).
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, clock } = getAppContext();
  const weather = createResource(() => api.weather(), WEATHER_REFRESH_MS);
  onDestroy(weather.destroy);

  const optional = (value: number | null, format: (n: number) => string) => (value === null ? '—' : format(value));
  const timeOf = (iso: string | null) => (iso ? formatTime(new Date(iso)) : '—');
</script>

<div class="weather-page">
  <PageHeader {back} title={weather.data?.forecast ? `Météo · ${weather.data.forecast.location}` : 'Météo'}>
    {#if weather.data?.forecast}
      <span class="muted">Météo-France · mis à jour à {formatTime(new Date(weather.data.forecast.observedAt))}</span>
    {/if}
  </PageHeader>

  {#if weather.data?.forecast}
    {@const { current, hours, days } = weather.data.forecast}
    {@const today = days[0]}
    {@const spell = firstRainSpell(hours)}
    {@const rain = rainLine(spell, clock.now)}
    <div class="layout">
      <div class="column">
        <!-- Seule carte sans étiquette : la température prime, comme l'horloge de l'accueil. -->
        <Card>
          <div class="now">
            <div class="now-main">
              <Icon name={weatherIcon(current.weatherCode, current.isDay)} size={96} color={weatherIconColor(current.weatherCode, current.isDay)} strokeWidth={1.5} />
              <span class="big">{formatTemperature(current.temperatureC)}</span>
            </div>
            <span class="condition">{weatherLabel(current.weatherCode)}</span>
            <span class="muted">
              {[
                current.apparentC === null ? null : `Ressenti ${formatTemperature(current.apparentC)}`,
                today ? `min ${formatTemperature(today.minC)}` : null,
                today ? `max ${formatTemperature(today.maxC)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span class="rain-pill" class:dry={!rain}>{rain ?? 'Pas de pluie dans les 24 h'}</span>
          </div>
        </Card>

        <div class="tiles">
          <Card title="Vent">
            <div class="tile">
              <span class="tile-value">
                {optional(current.windKmh, (n) => `${Math.round(n)} km/h`)}{current.windFromDeg === null ? '' : ` ${windDirection(current.windFromDeg)}`}
              </span>
              <span class="muted">{current.gustsKmh === null ? '' : `Rafales ${Math.round(current.gustsKmh)} km/h`}</span>
            </div>
          </Card>
          <Card title="Humidité">
            <div class="tile">
              <span class="tile-value">{optional(current.humidityPct, (n) => `${Math.round(n)} %`)}</span>
              <span class="muted">{current.humidityPct === null ? '' : humidityLabel(current.humidityPct)}</span>
            </div>
          </Card>
          <Card title="Soleil">
            <div class="tile">
              <span class="tile-value">{timeOf(today?.sunrise ?? null)} · {timeOf(today?.sunset ?? null)}</span>
              <span class="muted">Lever · coucher</span>
            </div>
          </Card>
          <Card title="Pluie">
            <div class="tile">
              <span class="tile-value">{spell ? formatMm(spell.totalMm) : 'Sec'}</span>
              <span class="muted">{spell ? `De ${formatHour(spell.start)} à ${formatHour(spell.end)}` : 'Dans les 24 h'}</span>
            </div>
          </Card>
        </div>
      </div>

      <div class="column">
        <Card title="Prochaines 24 heures">
          {#snippet aside()}
            <span class="legend">
              <span><span class="swatch line"></span>Température</span>
              <span><span class="swatch bar"></span>Pluie (mm)</span>
            </span>
          {/snippet}
          <HourlyChart {hours} />
        </Card>

        <Card title="Prochains jours" grow>
          <div class="days">
            {#each days as day, i (day.date)}
              <div class="day" class:today={i === 0}>
                <span class="day-name">{formatDay(new Date(day.date), clock.now)}</span>
                <Icon name={weatherIcon(day.weatherCode, true)} size={44} color={weatherIconColor(day.weatherCode, true)} strokeWidth={1.6} />
                <span class="day-label">{weatherLabel(day.weatherCode)}</span>
                <span class="day-temps"><b>{formatTemperature(day.maxC)}</b> <span class="min">{formatTemperature(day.minC)}</span></span>
                <span class="muted small">{dayExtra(day.precipitationMm, day.windMaxKmh)}</span>
              </div>
            {/each}
          </div>
        </Card>
      </div>
    </div>
  {:else if weather.data}
    <p class="muted">Météo indisponible pour le moment, nouvel essai dans quelques minutes.</p>
  {:else if weather.error}
    <p class="muted">Impossible de charger la météo : {weather.error}</p>
  {/if}
</div>

<style>
  .weather-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    box-sizing: border-box;
  }

  .muted {
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .small {
    font-size: var(--text-label);
  }

  .layout {
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 400px minmax(0, 1fr);
    gap: var(--space-2);
  }

  /* Colonnes de hauteur fixe : les cartes se partagent la hauteur, aucune ne pousse la page. */
  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
  }

  .now {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .now-main {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  /* Comme l'horloge de l'accueil, la température sort de l'échelle de texte : lisible de loin. */
  .big {
    font-size: 7rem;
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.04em;
  }

  .condition {
    font-size: var(--text-title);
    font-weight: 600;
  }

  .rain-pill {
    margin-top: var(--space-1);
    align-self: flex-start;
    padding: var(--space-1) 14px;
    border-radius: 999px;
    background: var(--rain-bg);
    color: var(--rain-soft);
    font-size: var(--text-small);
    font-weight: 600;
  }

  .rain-pill.dry {
    background: var(--surface-2);
    color: var(--fg-muted);
  }

  .tiles {
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: minmax(0, 1fr);
    gap: var(--space-2);
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tile-value {
    font-size: var(--text-title);
    font-weight: 600;
  }

  .legend {
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-label);
    color: var(--fg-muted);
  }

  .legend > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch.line {
    width: 18px;
    height: 3px;
    border-radius: 2px;
    background: var(--sun);
  }

  .swatch.bar {
    width: 10px;
    height: 14px;
    border-radius: 3px;
    background: var(--rain);
  }

  .days {
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .day {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .day.today {
    outline: 2px solid var(--border-strong);
  }

  .day-name {
    font-size: var(--text-body);
    font-weight: 600;
  }

  .day-label {
    font-size: var(--text-small);
    color: var(--fg-soft);
  }

  .day-temps {
    font-size: var(--text-title);
  }

  .day-temps .min {
    color: var(--fg-muted);
  }
</style>
