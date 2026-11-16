<script lang="ts">
  // Carte « Cette semaine » des tableaux de bord de la tablette : les prochains rendez-vous. Celui dont le lieu est
  // reconnu (`routable`) porte une petite icône de bus : le toucher ouvre son trajet (`onTrip`).
  import { eventKey } from '../../../../shared/trip.ts';
  import type { CalendarEvent } from '../../../../shared/types.ts';
  import { formatEventWhen } from '../../lib/format.ts';
  import Card from '../Card.svelte';
  import Icon from '../Icon.svelte';

  type Props = { events: CalendarEvent[]; now: Date; routable?: ReadonlySet<string>; onTrip?: (key: string, title: string) => void };
  let { events, now, routable = new Set(), onTrip }: Props = $props();
</script>

<Card title="Cette semaine" link={{ to: 'week', label: 'Semaine détaillée' }}>
  {#if events.length === 0}
    <p class="empty">Rien d’autre de prévu</p>
  {:else}
    <ul>
      {#each events as event (event.id)}
        {@const key = onTrip && routable.has(eventKey(event)) ? eventKey(event) : null}
        <li>
          {#if key}
            <button type="button" class="row" aria-label="{event.title} : voir le trajet" onclick={() => onTrip?.(key, event.title)}>
              <span>{event.title}</span>
              <span class="when">{formatEventWhen(event, now)}</span>
              <span class="route" aria-hidden="true"><Icon name="bus" size={16} /></span>
            </button>
          {:else}
            <span>{event.title}</span>
            <span class="when">{formatEventWhen(event, now)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Card>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-x: hidden;
    overflow-y: auto;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    padding: 10px 0;
    border-top: 1px solid var(--surface-2);
    font-size: 1.25rem;
  }

  .row {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .route {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 50%;
    background: var(--rain-bg);
    color: var(--rain-soft);
  }

  .when {
    margin-left: auto;
    color: var(--fg-muted);
  }

  .empty {
    margin: 0;
    font-size: 1.3rem;
    color: var(--fg-muted);
  }
</style>
