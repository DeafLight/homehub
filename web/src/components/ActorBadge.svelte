<script lang="ts">
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { getAppContext } from '../lib/context.ts';

  // Qui la caméra reconnaît devant la tablette : son avatar et son prénom, « Personne » si la caméra tourne sans
  // reconnaître personne, rien si elle ne tourne pas. En colonne dans le rail des dashboards, en ligne sur l'accueil.
  type Props = { row?: boolean };
  let { row = false }: Props = $props();

  const { actor, profiles } = getAppContext();
  const actorProfile = $derived(profiles.find((p) => p.id === actor.current?.id));
</script>

{#if actorProfile}
  <div class="actor" class:row role="status" aria-label="Reconnu : {actorProfile.name}">
    <Avatar profile={actorProfile} size={row ? 40 : 48} />
    <span>{actorProfile.name}</span>
  </div>
{:else if actor.camera === 'on'}
  <div class="actor nobody" class:row role="status" aria-label="Personne n'est reconnu">
    <Icon name="face" size={32} />
    <span>Personne</span>
  </div>
{/if}

<style>
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
