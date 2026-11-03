<script lang="ts">
  import { getAppContext } from '../lib/context.ts';
  import { type PageRoute, routePath } from '../lib/route.ts';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  // Retour d'une page de détail vers la page qui l'a ouverte : un profil (avatar et prénom) ou l'accueil.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { profiles, navigate } = getAppContext();
  const profile = $derived(back.name === 'dashboard' ? profiles.find((p) => p.id === back.ownerId) : undefined);
</script>

<button
  class="back"
  type="button"
  aria-label={profile ? `Retour au profil de ${profile.name}` : 'Retour à l’accueil'}
  onclick={() => navigate(routePath(profile ? back : { name: 'home' }))}
>
  <Icon name="back" size={30} strokeWidth={2.2} />
  {#if profile}
    <Avatar {profile} size={36} />
    {profile.name}
  {:else}
    Accueil
  {/if}
</button>

<style>
  .back {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 14px;
    min-height: 72px;
    padding: 0 28px 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: inherit;
    font: inherit;
    font-size: 1.4rem;
    font-weight: 600;
    cursor: pointer;
  }

  .back:active {
    background: var(--border-strong);
  }
</style>
