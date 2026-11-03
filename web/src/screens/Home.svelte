<script lang="ts">
  import { onDestroy } from 'svelte';
  import Avatar from '../components/Avatar.svelte';
  import Icon from '../components/Icon.svelte';
  import DetailLink from '../components/DetailLink.svelte';
  import SettingsMenu from '../components/SettingsMenu.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { eventLine, formatLongDate, formatTime, profileHeadline } from '../lib/format.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { dashboardPath } from '../lib/route.ts';
  import { formatTemperature, weatherIcon, weatherIconColor, weatherLabel, weatherOutlook } from '../lib/weather.ts';

  const HOME_REFRESH_MS = 60_000;

  const { api, profiles, config, clock, navigate } = getAppContext();
  const home = createResource(() => api.home(), HOME_REFRESH_MS);
  onDestroy(home.destroy);

  const summaries = $derived(new Map(home.data?.profiles.map((p) => [p.ownerId, p]) ?? []));
</script>

<div class="home">
  <section class="ambient">
    <div class="clock">
      <div class="time">{formatTime(clock.now)}</div>
      <div class="date">{formatLongDate(clock.now)}</div>
      <!-- Version du front réellement chargé sur la tablette : permet de vérifier qu'un déploiement est arrivé.
           Elle ouvre la page du NAS qui héberge HomeHub. -->
      <DetailLink to="nas" label="État du NAS" chevronSize={20}>
        <span class="version">HomeHub v{__APP_VERSION__}</span>
      </DetailLink>
    </div>

    {#if home.data}
      {@const { weather, familyHighlight } = home.data}
      <div class="bottom">
        {#if weather}
          <DetailLink to="weather" label="Météo détaillée">
            <Icon
              name={weatherIcon(weather.weatherCode, weather.isDay)}
              size={56}
              color={weatherIconColor(weather.weatherCode, weather.isDay)}
              strokeWidth={1.6}
            />
            <span class="weather-text">
              <span class="temperature">
                {formatTemperature(weather.temperatureC)} · {weatherLabel(weather.weatherCode)}
              </span>
              <span class="muted">{weatherOutlook(weather, clock.now)}</span>
            </span>
          </DetailLink>
        {/if}
        {#if familyHighlight}
          <DetailLink to="week" label="Semaine de la famille" variant="block">
            <span class="highlight">
              <span class="highlight-body">
                <span class="label">{config.family.name}</span>
                <span class="highlight-text">{eventLine(familyHighlight, clock.now)}</span>
              </span>
              <Icon name="chevron" size={32} color="var(--fg-muted)" strokeWidth={2} />
            </span>
          </DetailLink>
        {/if}
      </div>
    {/if}
  </section>

  <section class="profiles">
    <h1>Qui est là ?</h1>
    {#each profiles as profile (profile.id)}
      {@const summary = summaries.get(profile.id)}
      <button
        class="profile"
        class:family={profile.isFamily}
        type="button"
        onclick={() => navigate(dashboardPath(profile.id))}
      >
        <Avatar {profile} size={72} />
        <span class="profile-text">
          <span class="name">{profile.name}</span>
          <span class="muted">
            {#if profile.isFamily}
              Agenda commun, courses, mots
            {:else if summary}
              {profileHeadline(summary, clock.now)}
            {:else}
              &nbsp;
            {/if}
          </span>
        </span>
        <Icon name="chevron" size={32} color="var(--fg-muted)" strokeWidth={2} />
      </button>
    {/each}
    <div class="settings"><SettingsMenu placement="above" size={72} /></div>
  </section>
</div>

<style>
  .home {
    height: 100%;
    display: flex;
  }

  .ambient {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 56px;
    background: var(--surface-rail);
  }

  .clock {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .time {
    font-size: clamp(6rem, 13vw, 10rem);
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
  }

  .date {
    font-size: 1.9rem;
    color: var(--fg-muted);
  }

  .version {
    font-size: 0.95rem;
    color: var(--fg-muted);
  }

  .bottom {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .weather-text,
  .highlight-body,
  .profile-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .temperature {
    font-size: 2.5rem;
    font-weight: 600;
  }

  .muted {
    font-size: 1.25rem;
    color: var(--fg-muted);
  }

  .highlight {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px 24px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .label {
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .highlight-body {
    flex-grow: 1;
    gap: 8px;
  }

  .highlight-text {
    font-size: 1.5rem;
  }

  .profiles {
    width: 520px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 40px 48px;
    box-sizing: border-box;
    overflow-y: auto;
  }

  h1 {
    margin: 0 0 6px;
    font-size: 2.25rem;
    font-weight: 600;
  }

  .profile {
    display: flex;
    align-items: center;
    gap: 20px;
    min-height: 100px;
    padding: 12px 20px;
    box-sizing: border-box;
    border: 2px solid var(--surface-2);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .profile:active {
    background: var(--surface-2);
  }

  .profile.family {
    background: transparent;
    border-style: dashed;
    border-color: var(--border-strong);
  }

  .profile-text {
    flex-grow: 1;
  }

  .name {
    font-size: 1.75rem;
    font-weight: 600;
  }

  .settings {
    display: flex;
    justify-content: flex-end;
    margin-top: auto;
    padding-top: 8px;
  }
</style>
