<script lang="ts">
  import { getAppContext } from '../lib/context.ts';
  import { formatTime } from '../lib/format.ts';
  import { dashboardPath, HOME_PATH } from '../lib/route.ts';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import SettingsMenu from './SettingsMenu.svelte';

  // Rail latéral : retour à l'accueil, passage direct d'un profil à l'autre, personne reconnue devant la tablette (qui
  // peut terminer sa session) et roue dentée (tablette seulement).
  type Props = { currentId: string };
  let { currentId }: Props = $props();

  const { actor, profiles, clock, navigate } = getAppContext();
  const actorProfile = $derived(profiles.find((p) => p.id === actor.current?.id));
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
    {#if actorProfile}
      <button class="actor" type="button" aria-label="Terminer la session de {actorProfile.name}" onclick={() => actor.end()}>
        <Avatar profile={actorProfile} size={48} />
        <span>Terminer</span>
      </button>
    {/if}
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

  .bottom {
    margin-top: auto;
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .actor {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .time {
    font-size: 1.6rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
