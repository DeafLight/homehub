<script lang="ts">
  import { FAMILY_ID, type WeekData } from '../../../../shared/types.ts';
  import { agendaDays } from '../../lib/agenda.ts';
  import { capitalize, formatDay } from '../../lib/format.ts';
  import type { AgendaItem } from '../../lib/agenda.ts';
  import type { Profile } from '../../lib/profiles.ts';
  import type { HolidayStatus } from '../../../../shared/school-holidays.ts';
  import Avatar from '../Avatar.svelte';
  import HolidayChip from '../HolidayChip.svelte';
  import Icon from '../Icon.svelte';

  // Onglet Agenda du téléphone : les 7 prochains jours, ce qui concerne ce profil ou toute la famille. Un rendez-vous
  // dont le lieu est reconnu (`routable`, dit par le serveur) porte une petite icône de bus : le toucher ouvre son trajet.
  type Props = {
    /** Cette semaine et la suivante ; null tant qu'elles ne sont pas chargées. */
    weeks: WeekData[] | null;
    loadError: string | null;
    /** Vacances scolaires à annoncer, en tête de l'agenda. */
    holiday: HolidayStatus | null;
    meId: string;
    now: Date;
    profileOf: (id: string) => Profile | undefined;
    /** Clés des rendez-vous dont le lieu est reconnu (vide tant qu'on ne sait pas). */
    routable: ReadonlySet<string>;
    onTrip: (item: AgendaItem & { key: string }) => void;
  };
  let { weeks, loadError, holiday, meId, now, profileOf, routable, onTrip }: Props = $props();
</script>

{#if holiday}
  <div class="holiday"><HolidayChip {holiday} size="small" /></div>
{/if}

{#if weeks}
  {#each agendaDays(weeks, new Set([meId, FAMILY_ID]), now) as day (day.date.getTime())}
    <section class="day">
      <h2>{capitalize(formatDay(day.date, now))}</h2>
      <ul>
        {#each day.items as item (item.id)}
          {@const owner = profileOf(item.ownerId)}
          {@const key = item.key && routable.has(item.key) ? item.key : null}
          <li>
            {#if key}
              <button type="button" class="row" aria-label="{item.title} : voir le trajet" onclick={() => onTrip({ ...item, key })}>
                <span class="when">{item.when}</span>
                <span class="title">{item.title}</span>
                <span class="route" aria-hidden="true"><Icon name="bus" size={18} /></span>
                {#if owner}<Avatar profile={owner} size={26} />{/if}
              </button>
            {:else}
              <span class="when">{item.when}</span>
              <span class="title">{item.title}</span>
              {#if owner}<Avatar profile={owner} size={26} />{/if}
            {/if}
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
  .holiday {
    margin-top: 12px;
  }

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

  /* Rendez-vous touchable : toute la ligne est un bouton, icône de bus avant l'avatar. */
  .row {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    margin: 0 -14px;
    padding: 0 14px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }

  .route {
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    border-radius: 50%;
    background: var(--rain-bg);
    color: var(--rain-soft);
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
