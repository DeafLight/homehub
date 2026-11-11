<script lang="ts">
  import { onDestroy } from 'svelte';
  import ActorBadge from '../components/ActorBadge.svelte';
  import Avatar from '../components/Avatar.svelte';
  import Icon from '../components/Icon.svelte';
  import DetailLink from '../components/DetailLink.svelte';
  import HolidayChip from '../components/HolidayChip.svelte';
  import SettingsMenu from '../components/SettingsMenu.svelte';
  import TransitBoard from '../components/widgets/TransitBoard.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { eventLine, formatLongDate, formatTime, greeting, pluralize, profileHeadline } from '../lib/format.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { dashboardPath, detailPath } from '../lib/route.ts';
  import { homeworkReminder } from '../lib/homework.ts';
  import { routineName } from '../lib/routine.ts';
  import { formatTemperature, weatherIcon, weatherIconColor, weatherLabel, weatherOutlook } from '../lib/weather.ts';

  const HOME_REFRESH_MS = 60_000;

  const { api, actor, profiles, config, clock, navigate, router, timers } = getAppContext();
  const TRANSIT_REFRESH_MS = 30_000;

  const home = createResource(() => api.home(), HOME_REFRESH_MS);
  onDestroy(home.destroy);
  // Passages Irigo : le serveur ne recontacte Irigo qu'au rythme réglé (60 s) ; les minutes se recomptent à l'horloge.
  const transit = createResource(() => api.transit(), TRANSIT_REFRESH_MS);
  onDestroy(transit.destroy);

  const summaries = $derived(new Map(home.data?.profiles.map((p) => [p.ownerId, p]) ?? []));
  // Personne reconnue : son accueil à elle (mots, routine, tâches, prochain rendez-vous), en un coup d'œil.
  const me = $derived(actor.current ? summaries.get(actor.current.id) : undefined);
</script>

<!-- Accueil, piste A (docs/design.md) : à gauche l'heure et des cartes de même facture (météo, famille, passages) ;
     à droite « Qui est là ? » et, en bas, la barre d'actions Minuteur · Scanner · Réglages. -->
<div class="home">
  <section class="ambient">
    <div class="clock">
      <div class="time">{formatTime(clock.now)}</div>
      <div class="date">{formatLongDate(clock.now)}</div>
      {#if home.data?.holiday}
        <HolidayChip holiday={home.data.holiday} />
      {/if}
      <!-- Version du front réellement chargé sur la tablette : permet de vérifier qu'un déploiement est arrivé.
           Elle ouvre la page du NAS qui héberge HomeHub. -->
      <DetailLink to="nas" label="État du NAS" chevronSize={18}>
        <span class="version">HomeHub v{__APP_VERSION__}</span>
      </DetailLink>
    </div>

    {#if actor.current && me}
      {@const who = actor.current}
      {@const headline = profileHeadline({ ...me, pendingTasks: 0 }, clock.now)}
      <button type="button" class="welcome" style:--accent={who.color} onclick={() => navigate(dashboardPath(who.id))}>
        <span class="welcome-title">{greeting(clock.now)} {who.name} !</span>
        {#if me.unreadNotes}
          <span class="line unread"><Icon name="message" size={24} /> {pluralize(me.unreadNotes, 'mot')} pour toi</span>
        {/if}
        {#if me.routine}
          <span class="line">
            <Icon name="check" size={24} />
            {routineName(me.routine.period)} : {me.routine.done === me.routine.total ? 'finie, bravo !' : `${me.routine.done}/${me.routine.total}`}
          </span>
        {/if}
        {#if homeworkReminder(me.homework, clock.now)}
          <span class="line"><Icon name="pencil" size={24} /> {homeworkReminder(me.homework, clock.now)}</span>
        {/if}
        {#if me.nextTasks.length}
          <span class="line">
            <Icon name="list" size={24} />
            À faire : {me.nextTasks.join(', ')}{me.pendingTasks > me.nextTasks.length ? '…' : ''}
          </span>
        {/if}
        {#if headline !== 'Rien de prévu'}
          <span class="line"><Icon name="calendar" size={24} /> {headline}</span>
        {/if}
      </button>
    {/if}

    {#if home.data}
      {@const { weather, familyHighlight } = home.data}
      <div class="bottom">
        {#if weather || familyHighlight}
          <div class="pair">
            {#if weather}
              <DetailLink to="weather" label="Météo détaillée" variant="block">
                <span class="tile">
                  <span class="card-label">Météo</span>
                  <span class="tile-row">
                    <Icon
                      name={weatherIcon(weather.weatherCode, weather.isDay)}
                      size={48}
                      color={weatherIconColor(weather.weatherCode, weather.isDay)}
                      strokeWidth={1.6}
                    />
                    <span class="tile-text">
                      <span class="temperature">{formatTemperature(weather.temperatureC)} · {weatherLabel(weather.weatherCode)}</span>
                      <span class="muted">{weatherOutlook(weather, clock.now)}</span>
                    </span>
                  </span>
                </span>
              </DetailLink>
            {/if}
            {#if familyHighlight}
              <DetailLink to="week" label="Semaine de la famille" variant="block">
                <span class="tile">
                  <span class="card-label">{config.family.name}</span>
                  <span class="tile-row">
                    <span class="highlight-text">{eventLine(familyHighlight, clock.now)}</span>
                    <Icon name="chevron" size={24} color="var(--fg-muted)" strokeWidth={2} />
                  </span>
                </span>
              </DetailLink>
            {/if}
          </div>
        {/if}
        {#if transit.data && transit.data.stops.length > 0}
          <div class="tile">
            <span class="card-label">Prochains passages</span>
            <TransitBoard transit={transit.data} now={clock.now} />
          </div>
        {/if}
      </div>
    {/if}
  </section>

  <section class="profiles">
    <div class="profiles-head">
      <h1>Qui est là ?</h1>
      <ActorBadge row />
    </div>
    <div class="profile-list">
      {#each profiles as profile (profile.id)}
        {@const summary = summaries.get(profile.id)}
        <button
          class="profile"
          class:family={profile.isFamily}
          class:recognized={actor.current?.id === profile.id}
          type="button"
          onclick={() => navigate(dashboardPath(profile.id))}
        >
          <Avatar {profile} size={56} />
          <span class="profile-text">
            <span class="name">
              {profile.name}
              {#if summary?.unreadNotes}
                <span class="badge" aria-label="{pluralize(summary.unreadNotes, 'mot')} pas encore vu">
                  <Icon name="message" size={16} /> {summary.unreadNotes}
                </span>
              {/if}
            </span>
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
          <Icon name="chevron" size={28} color="var(--fg-muted)" strokeWidth={2} />
        </button>
      {/each}
    </div>
    <div class="actions">
      <button type="button" class="action" onclick={() => (timers.dialog = true)}>
        <Icon name="timer" size={32} />
        <span>Minuteur</span>
      </button>
      <!-- Scanner du stock : ranger les courses, déclarer un produit épuisé. -->
      <button type="button" class="action accent" onclick={() => navigate(detailPath('scan', router.route))}>
        <Icon name="barcode" size={32} />
        <span>Scanner</span>
      </button>
      <SettingsMenu placement="above" size={88} labelled />
    </div>
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
    gap: var(--space-3);
    padding: var(--space-6);
    box-sizing: border-box;
    background: var(--bg);
  }

  .clock {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .time {
    font-size: clamp(5.5rem, 11vw, 8.5rem);
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
  }

  .date {
    font-size: 1.75rem;
    color: var(--fg-muted);
  }

  .version {
    font-size: 0.95rem;
    color: var(--fg-muted);
  }

  .bottom {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .pair {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: var(--space-2);
  }

  /* Carte de la piste A : fond --surface, rayon --radius-lg, étiquette en petites capitales (comme Card.svelte). */
  .tile {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
    padding: var(--space-3);
    box-sizing: border-box;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .tile-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .tile-text,
  .profile-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .temperature {
    font-size: var(--text-title);
    font-weight: 600;
  }

  .muted {
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .highlight-text {
    flex-grow: 1;
    min-width: 0;
    font-size: var(--text-body);
    line-height: 1.3;
  }

  .profiles {
    width: 440px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    box-sizing: border-box;
    background: var(--surface-rail);
  }

  .profiles-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 56px;
  }

  h1 {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 600;
  }

  .profile-list {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    overflow-y: auto;
  }

  .profile {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-2);
    min-height: 84px;
    padding: 10px var(--space-2);
    box-sizing: border-box;
    border: 2px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  /* Personne reconnue par la caméra : son profil ressort. */
  .profile.recognized {
    border-color: var(--fg);
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
    font-size: var(--text-title);
    font-weight: 600;
  }

  .welcome {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-left: 6px solid var(--accent);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .welcome-title {
    font-size: 1.75rem;
    font-weight: 600;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: var(--text-body);
    color: var(--fg-soft);
  }

  .line.unread {
    color: var(--sun);
    font-weight: 700;
    animation: glow 1.6s ease-in-out infinite;
  }

  @keyframes glow {
    50% {
      opacity: 0.55;
    }
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: var(--space-1);
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--sun);
    color: var(--bg);
    font-size: 1rem;
    font-weight: 700;
    vertical-align: middle;
  }

  .actions {
    display: flex;
    gap: var(--space-1);
  }

  .action {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 88px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-label);
    font-weight: 600;
    cursor: pointer;
  }

  .action:active {
    background: var(--border-strong);
  }

  .action.accent {
    background: var(--rain-bg);
    color: var(--rain-soft);
  }
</style>
