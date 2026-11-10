<script lang="ts">
  import { type FitnessState, RPE_LABELS } from '../../../../shared/fitness.ts';
  import Icon from '../Icon.svelte';
  import SportCard from './SportCard.svelte';

  // Historique récent (onglet Sport) : les dix dernières séances, la plus récente en tête ; une séance se supprime en
  // deux touchers (corbeille, puis « Supprimer »).
  type Props = { sessions: FitnessState['sessions']; busy: boolean; onRemove: (id: string) => void };
  let { sessions, busy, onRemove }: Props = $props();

  let confirmDelete = $state<string | null>(null);
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
</script>

<SportCard>
  <h2>Historique</h2>
  <ul class="history">
    {#each sessions.slice(-10).reverse() as s (s.id)}
      <li>
        <span class="when">{formatDate(s.at)}</span>
        <span class="what">
          Séance {s.session} · {s.effort}/{s.rest} · {RPE_LABELS[s.rpe].toLowerCase()}{s.stopped ? ' · arrêtée' : ''}
        </span>
        {#if confirmDelete === s.id}
          <button type="button" class="danger" disabled={busy} onclick={() => onRemove(s.id)}>Supprimer</button>
        {:else}
          <button type="button" class="icon" aria-label="Supprimer cette séance" onclick={() => (confirmDelete = s.id)}><Icon name="trash" size={18} /></button>
        {/if}
      </li>
    {/each}
  </ul>
</SportCard>

<style>
  .history {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .history li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    border-bottom: 1px solid var(--surface-2);
  }

  .history li:last-child {
    border-bottom: 0;
  }

  .when {
    min-width: 86px;
    color: var(--fg-muted);
    font-size: 0.92rem;
  }

  .what {
    flex: 1;
    min-width: 0;
  }

  .icon {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--fg-muted);
  }

  .danger {
    min-height: 38px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--danger-bg);
    color: var(--danger-fg);
    font: inherit;
    font-weight: 600;
  }
</style>
