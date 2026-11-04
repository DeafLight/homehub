<script lang="ts">
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { onDestroy } from 'svelte';
  import { getAppContext } from '../lib/context.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { dashboardPath } from '../lib/route.ts';

  // Qui la caméra reconnaît devant la tablette : son avatar et son prénom, « Personne » si la caméra tourne sans
  // reconnaître personne, rien si elle ne tourne pas. En colonne dans le rail des dashboards, en ligne sur l'accueil.
  // Des mots l'attendent : leur nombre clignote doucement ; toucher ouvre son dashboard.
  const NOTES_REFRESH_MS = 30_000;

  type Props = { row?: boolean };
  let { row = false }: Props = $props();

  const { api, actor, profiles, navigate } = getAppContext();
  const actorProfile = $derived(profiles.find((p) => p.id === actor.current?.id));
  const notes = createResource(() => api.notes(), NOTES_REFRESH_MS);
  onDestroy(notes.destroy);
  const unread = $derived(actorProfile ? (notes.data ?? []).filter((n) => n.to === actorProfile.id && !n.seenAt).length : 0);

  // Dès qu'une personne est reconnue, ses mots du moment (sans attendre le prochain rafraîchissement).
  $effect(() => {
    if (actorProfile) void notes.refresh();
  });
</script>

{#if actorProfile}
  <button
    type="button"
    class="actor"
    class:row
    aria-label="Reconnu : {actorProfile.name}{unread ? `, ${unread} mot${unread > 1 ? 's' : ''} pas encore vu` : ''}"
    onclick={() => navigate(dashboardPath(actorProfile.id))}
  >
    <Avatar profile={actorProfile} size={row ? 40 : 48} />
    <span>{actorProfile.name}</span>
    {#if unread}<span class="unread"><Icon name="message" size={16} /> {unread}</span>{/if}
  </button>
{:else if actor.camera === 'on'}
  <div class="actor nobody" class:row role="status" aria-label="Personne n'est reconnu">
    <Icon name="face" size={32} />
    <span>Personne</span>
  </div>
{/if}

<style>
  button.actor {
    border: 0;
    color: inherit;
    font-family: inherit;
    cursor: pointer;
  }

  .unread {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--sun);
    color: var(--bg);
    font-weight: 700;
    animation: glow 1.6s ease-in-out infinite;
  }

  @keyframes glow {
    50% {
      opacity: 0.55;
    }
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

  .actor.row {
    flex-direction: row;
    gap: 12px;
    padding: 8px 16px 8px 8px;
    font-size: 1.15rem;
  }

  .actor.nobody {
    color: var(--fg-muted);
    background: none;
  }
</style>
