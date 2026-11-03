<script lang="ts">
  import { onDestroy } from 'svelte';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
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

  // Page météo détaillée : `back` est la page qui l'a ouverte (accueil ou profil), où ramène le bouton retour.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, clock } = getAppContext();
  const weather = createResource(() => api.weather(), WEATHER_REFRESH_MS);
  onDestroy(weather.destroy);

  const optional = (value: number | null, format: (n: number) => string) => (value === null ? '—' : format(value));
  const timeOf = (iso: string | null) => (iso ? formatTime(new Date(iso)) : '—');
</script>

<div class="weather-page">
  <header>
    <BackButton {back} />
    {#if weather.data?.forecast}
      {@const forecast = weather.data.forecast}
      <h1>Météo · {forecast.location}</h1>
      <span class="muted updated">Météo-France · mis à jour à {formatTime(new Date(forecast.observedAt))}</span>
    {:else}
      <h1>Météo</h1>
    {/if}
  </header>

  {#if weather.data?.forecast}
    {@const { current, hours, days } = weather.data.forecast}
    {@const today = days[0]}
    {@const spell = firstRainSpell(hours)}
    {@const rain = rainLine(spell, clock.now)}
    <div class="layout">
      <div class="column">
        <section class="card now">
          <div class="now-main">
            <Icon name={weatherIcon(current.weatherCode, current.isDay)} size={96} color={weatherIconColor(current.weatherCode, current.isDay)} strokeWidth={1.5} />
            <span class="big">{formatTemperature(current.temperatureC)}</span>
          </div>
          <span class="label-big">{weatherLabel(current.weatherCode)}</span>
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
        </section>

        <section class="tiles">
          <div class="tile">
            <span class="tile-label">Vent</span>
            <span class="tile-value">
              {optional(current.windKmh, (n) => `${Math.round(n)} km/h`)}{current.windFromDeg === null ? '' : ` ${windDirection(current.windFromDeg)}`}
            </span>
            <span class="muted small">{current.gustsKmh === null ? '' : `Rafales ${Math.round(current.gustsKmh)} km/h`}</span>
          </div>
          <div class="tile">
            <span class="tile-label">Humidité</span>
            <span class="tile-value">{optional(current.humidityPct, (n) => `${Math.round(n)} %`)}</span>
            <span class="muted small">{current.humidityPct === null ? '' : humidityLabel(current.humidityPct)}</span>
          </div>
          <div class="tile">
            <span class="tile-label">Soleil</span>
            <span class="tile-value">{timeOf(today?.sunrise ?? null)} · {timeOf(today?.sunset ?? null)}</span>
            <span class="muted small">Lever · coucher</span>
          </div>
          <div class="tile">
            <span class="tile-label">Pluie</span>
            <span class="tile-value">{spell ? formatMm(spell.totalMm) : 'Sec'}</span>
            <span class="muted small">
              {spell ? `De ${formatHour(spell.start)} à ${formatHour(spell.end)}` : 'Dans les 24 h'}
            </span>
          </div>
        </section>
      </div>

      <div class="column">
        <section class="card">
          <div class="card-head">
            <h2>Prochaines 24 heures</h2>
            <span class="legend">
              <span><span class="swatch line"></span>Température</span>
              <span><span class="swatch bar"></span>Pluie (mm)</span>
            </span>
          </div>
          <HourlyChart {hours} />
        </section>

        <section class="card grow">
          <h2>Prochains jours</h2>
          <div class="days">
            {#each days as day, i (day.date)}
              <div class="day" class:today={i === 0}>
                <span class="day-name">{formatDay(new Date(day.date), clock.now)}</span>
                <Icon name={weatherIcon(day.weatherCode, true)} size={44} color={weatherIconColor(day.weatherCode, true)} strokeWidth={1.6} />
                <span class="day-label">{weatherLabel(day.weatherCode)}</span>
                <span class="day-temps"><b>{formatTemperature(day.maxC)}</b> <span class="muted">{formatTemperature(day.minC)}</span></span>
                <span class="muted small">{dayExtra(day.precipitationMm, day.windMaxKmh)}</span>
              </div>
            {/each}
          </div>
        </section>
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
    gap: 20px;
    padding: 28px 40px 36px;
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
    font-weight: 600;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .updated {
    margin-left: auto;
  }

  .muted {
    font-size: 1.2rem;
    color: var(--fg-muted);
  }

  .small {
    font-size: 1rem;
  }

  .layout {
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 400px minmax(0, 1fr);
    gap: 20px;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 0;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px 28px;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .grow {
    flex-grow: 1;
  }

  .now {
    gap: 6px;
    padding: 28px;
  }

  .now-main {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .big {
    font-size: 7rem;
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.04em;
  }

  .label-big {
    font-size: 1.9rem;
    font-weight: 600;
  }

  .rain-pill {
    margin-top: 8px;
    align-self: flex-start;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--rain-bg);
    color: var(--rain-soft);
    font-size: 1.05rem;
    font-weight: 600;
  }

  .rain-pill.dry {
    background: var(--surface-2);
    color: var(--fg-muted);
  }

  .tiles {
    flex-grow: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 18px 20px;
    border-radius: 22px;
    background: var(--surface);
  }

  .tile-label {
    font-size: 0.9rem;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .tile-value {
    font-size: 1.6rem;
    font-weight: 600;
  }

  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .legend {
    display: flex;
    gap: 18px;
    font-size: 0.95rem;
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
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .day {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 18px;
    border-radius: 20px;
    background: var(--surface-2);
  }

  .day.today {
    outline: 2px solid var(--border-strong);
  }

  .day-name {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .day-label {
    font-size: 1.05rem;
    color: var(--fg-soft);
  }

  .day-temps {
    font-size: 1.4rem;
  }

  .day-temps .muted {
    font-size: inherit;
  }
</style>
