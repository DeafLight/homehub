<script lang="ts">
  import { getAppContext } from '../lib/context.ts';
  import { formatTime } from '../lib/format.ts';
  import { dashboardPath, HOME_PATH } from '../lib/route.ts';
  import ActorBadge from './ActorBadge.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import SettingsMenu from './SettingsMenu.svelte';

  // Rail latéral : retour à l'accueil, passage direct d'un profil à l'autre, personne reconnue devant la tablette et
  // roue dentée (tablette seulement).
  type Props = { currentId: string };
  let { currentId }: Props = $props();

  const { profiles, clock, navigate, timers } = getAppContext();
</script>

<nav class="rail" aria-label="Profils">
  <button class="home" type="button" aria-label="Retour à l'accueil" onclick={() => navigate(HOME_PATH)}>
    <Icon name="home" size={40} />
  </button>
  <div class="separator"></div>
  {#each profiles as profile (profile.id)}
    {@const current = profile.id === currentId}
    <button
      class="profile"
      type="button"
      aria-label="Dashboard de {profile.name}"
      aria-current={current ? 'page' : undefined}
      style:border-color={current ? profile.color : 'transparent'}
      onclick={() => navigate(dashboardPath(profile.id))}
    >
      <Avatar {profile} size={64} dimmed={!current} />
    </button>
  {/each}
  <div class="bottom">
    <ActorBadge />
    <button type="button" class="timer" aria-label="Minuteur" onclick={() => (timers.dialog = true)}>
      <Icon name="timer" size={32} />
    </button>
    <SettingsMenu placement="side" size={64} />
  </div>
  <div class="time">{formatTime(clock.now)}</div>
</nav>

<style>
  .rail {
    width: 128px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 24px 0;
    box-sizing: border-box;
    background: var(--surface-rail);
    overflow-y: auto;
  }

  button {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .home {
    width: 88px;
    height: 88px;
    flex-shrink: 0;
    border-radius: var(--radius-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
  }

  .home:active {
    background: var(--border-strong);
  }

  .separator {
    width: 56px;
    height: 2px;
    flex-shrink: 0;
    background: var(--surface-2);
  }

  .profile {
    width: 80px;
    height: 80px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 4px solid transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }

  .timer {
    width: 64px;
    height: 64px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
    display: grid;
    place-items: center;
    cursor: pointer;
  }

  .bottom {
    margin-top: auto;
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .time {
    font-size: 1.6rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
