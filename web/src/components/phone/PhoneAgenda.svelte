<script lang="ts">
  import { FAMILY_ID, type WeekData } from '../../../../shared/types.ts';
  import { agendaDays } from '../../lib/agenda.ts';
  import { capitalize, formatDay } from '../../lib/format.ts';
  import type { Profile } from '../../lib/profiles.ts';
  import Avatar from '../Avatar.svelte';

  // Onglet Agenda du téléphone : les 7 prochains jours, ce qui concerne ce profil ou toute la famille.
  type Props = {
    /** Cette semaine et la suivante ; null tant qu'elles ne sont pas chargées. */
    weeks: WeekData[] | null;
    loadError: string | null;
    meId: string;
    now: Date;
    profileOf: (id: string) => Profile | undefined;
  };
  let { weeks, loadError, meId, now, profileOf }: Props = $props();
</script>

{#if weeks}
  {#each agendaDays(weeks, new Set([meId, FAMILY_ID]), now) as day (day.date.getTime())}
    <section class="day">
      <h2>{capitalize(formatDay(day.date, now))}</h2>
      <ul>
        {#each day.items as item (item.id)}
          {@const owner = profileOf(item.ownerId)}
          <li>
            <span class="when">{item.when}</span>
            <span class="title">{item.title}</span>
            {#if owner}<Avatar profile={owner} size={26} />{/if}
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="muted">Rien de prévu cette semaine.</p>
  {/each}
{:else if loadError}
  <p class="muted">Impossible de charger l’agenda : {loadError}</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }

  .day h2 {
    margin: 18px 0 6px;
    font-size: 0.9rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .day ul {
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: 18px;
    background: var(--surface);
  }

  .day li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 0 14px;
    border-bottom: 1px solid var(--surface-2);
  }

  .day li:last-child {
    border-bottom: 0;
  }

  .when {
    min-width: 58px;
    font-variant-numeric: tabular-nums;
    color: var(--fg-muted);
  }

  .title {
    flex: 1;
    font-size: 1.1rem;
  }
</style>
