<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ECRAN_REFRESH_MS, type EcranData } from '../../../shared/ecran.ts';
  import HolidayChip from '../components/HolidayChip.svelte';
  import Icon from '../components/Icon.svelte';
  import { createClock } from '../lib/clock.svelte.ts';
  import {
    drift,
    ECRAN_NO_TOKEN,
    ECRAN_UNKNOWN,
    ecranDays,
    ecranTime,
    ecranTitle,
    forecastDay,
    loadEcran,
    showDinner,
    todayLine,
  } from '../lib/ecran.ts';
  import { formatLongDate, formatTime } from '../lib/format.ts';
  import { formatTemperature, weatherIcon, weatherIconColor, weatherLabel } from '../lib/weather.ts';

  // Écran de veille de la télé (appli HomeHub TV, fonction 8), page /ecran ouverte dans la WebView de l'écran de veille
  // Android (HomeHubDream) avec le jeton de la télé : heure, météo du moment et des jours suivants, agenda d'aujourd'hui
  // et de demain, menu du soir, vacances. Rien de personnel. Lue de loin et à la télécommande, sans rien à toucher.
  // WebView d'Android 10 parfois ancienne : mise en page simple (flex, marges, unités vw), pas de CSS récent. Tout
  // l'écran se déplace un peu chaque minute (marquage des écrans). Données relues toutes les 5 minutes ; serveur
  // injoignable : les dernières restent, avec une mention discrète.
  type Props = { token: string | null };
  let { token }: Props = $props();

  const DRIFT_MS = 60_000;
  const clock = createClock(10_000);
  onDestroy(clock.destroy);

  let data = $state<EcranData | null>(null);
  let problem = $state<'unknown' | 'unreachable' | null>(null);
  let offset = $state({ x: 0, y: 0 });

  const now = $derived(clock.now);
  const days = $derived(data ? ecranDays(data.agenda, now) : []);

  async function refresh() {
    if (!token) return;
    const result = await loadEcran(token);
    if ('data' in result) {
      data = result.data;
      problem = null;
    } else problem = result.error;
  }

  onMount(() => {
    void refresh();
    const reload = setInterval(refresh, ECRAN_REFRESH_MS);
    const mover = setInterval(() => (offset = drift()), DRIFT_MS);
    return () => {
      clearInterval(reload);
      clearInterval(mover);
    };
  });
</script>

<main class="ecran" style:transform="translate({offset.x}vw, {offset.y}vh)">
  {#if !token || problem === 'unknown'}
    <div class="lonely">
      <div class="time">{formatTime(now)}</div>
      <p class="muted">{token ? ECRAN_UNKNOWN : ECRAN_NO_TOKEN}</p>
    </div>
  {:else}
    <section class="left">
      <div class="time">{formatTime(now)}</div>
      <div class="date">{formatLongDate(now)}</div>
      {#if data?.holiday}
        <div class="holiday"><HolidayChip holiday={data.holiday} /></div>
      {/if}
      {#if data?.weather}
        {@const w = data.weather}
        <div class="weather">
          <span class="icon"><Icon name={weatherIcon(w.weatherCode, w.isDay)} size={64} color={weatherIconColor(w.weatherCode, w.isDay)} /></span>
          <span class="temp">{formatTemperature(w.temperatureC)}</span>
          <span class="label">{weatherLabel(w.weatherCode)}</span>
        </div>
        <div class="muted line">{todayLine(w, now)}</div>
      {/if}
      {#if data && data.days.length > 0}
        <div class="days">
          {#each data.days as day (day.date)}
            <div class="day">
              <div class="day-name">{forecastDay(new Date(day.date), now)}</div>
              <Icon name={weatherIcon(day.weatherCode, true)} size={36} color={weatherIconColor(day.weatherCode, true)} />
              <div class="day-temp">{formatTemperature(day.minC)} / {formatTemperature(day.maxC)}</div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="right">
      {#if data && showDinner(data.dinner, now)}
        <div class="block">
          <h2>Ce soir au menu</h2>
          {#each data.dinner as title, i (i)}
            <div class="dinner">{title}</div>
          {/each}
        </div>
      {/if}
      {#each days as day (day.label)}
        <div class="block">
          <h2>{day.label}</h2>
          {#each day.events as event (event.id + event.start)}
            <div class="event">
              <span class="when">{ecranTime(event, now)}</span>
              <span class="what">{ecranTitle(event)}</span>
            </div>
          {/each}
        </div>
      {/each}
      {#if data && days.length === 0}
        <div class="block">
          <h2>Agenda</h2>
          <div class="muted">Rien de prévu aujourd’hui ni demain</div>
        </div>
      {/if}
    </section>
  {/if}
  {#if problem === 'unreachable'}
    <div class="offline">HomeHub injoignable, nouvel essai bientôt</div>
  {/if}
</main>

<style>
  .ecran {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6vh 6vw;
    box-sizing: border-box;
    background: var(--bg);
    color: var(--fg);
    overflow: hidden;
    cursor: none;
    transition: transform 3s ease-in-out;
  }

  .left {
    flex: 1 1 0;
    margin-right: 5vw;
  }

  .right {
    flex: 1 1 0;
    max-width: 44vw;
  }

  .lonely {
    text-align: center;
  }

  .time {
    font-size: 11vw;
    font-weight: 300;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .date {
    margin-top: 1vh;
    font-size: 2.6vw;
    color: var(--fg-soft);
  }

  .date::first-letter {
    text-transform: uppercase;
  }

  .holiday {
    margin-top: 2vh;
  }

  .weather {
    display: flex;
    align-items: center;
    margin-top: 4vh;
    font-size: 3vw;
  }

  .weather .icon {
    display: inline-flex;
    margin-right: 1.2vw;
  }

  .temp {
    margin-right: 1.2vw;
    font-weight: 600;
  }

  .label {
    color: var(--fg-soft);
  }

  .line {
    margin-top: 1vh;
    font-size: 1.8vw;
  }

  .days {
    display: flex;
    margin-top: 4vh;
  }

  .day {
    margin-right: 3vw;
    text-align: center;
    font-size: 1.6vw;
  }

  .day-name {
    margin-bottom: 0.8vh;
    color: var(--fg-muted);
  }

  .day-temp {
    margin-top: 0.8vh;
    color: var(--fg-soft);
    font-variant-numeric: tabular-nums;
  }

  .block {
    margin-bottom: 4vh;
    padding: 2.4vh 2vw;
    border-radius: 16px;
    background: var(--surface);
  }

  .block:last-child {
    margin-bottom: 0;
  }

  h2 {
    margin: 0 0 1.4vh;
    font-size: 1.3vw;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .dinner {
    font-size: 2.2vw;
    line-height: 1.3;
    color: var(--sun);
  }

  .event {
    display: flex;
    align-items: baseline;
    font-size: 2vw;
    line-height: 1.5;
  }

  .when {
    flex: 0 0 auto;
    min-width: 7vw;
    margin-right: 1.4vw;
    color: var(--rain-soft);
    font-variant-numeric: tabular-nums;
  }

  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    color: var(--fg-muted);
    font-size: 1.8vw;
  }

  .offline {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 3vh;
    text-align: center;
    font-size: 1.3vw;
    color: var(--fg-muted);
  }
</style>
