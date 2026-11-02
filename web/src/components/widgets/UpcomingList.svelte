<script lang="ts">
  import type { CalendarEvent } from '../../../../shared/types.ts';
  import { formatDay, formatTime } from '../../lib/format.ts';
  import Card from '../Card.svelte';

  type Props = { events: CalendarEvent[]; now: Date };
  let { events, now }: Props = $props();
</script>

<Card title="Cette semaine">
  {#if events.length === 0}
    <p class="empty">Rien d’autre de prévu</p>
  {:else}
    <ul>
      {#each events as event (event.id)}
        {@const start = new Date(event.start)}
        <li>
          <span>{event.title}</span>
          <span class="when">{formatDay(start, now)} {event.allDay ? 'journée' : formatTime(start)}</span>
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
    overflow-y: auto;
  }

  li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--surface-2);
    font-size: 1.25rem;
  }

  .when {
    flex-shrink: 0;
    color: var(--fg-muted);
  }

  .empty {
    margin: 0;
    font-size: 1.3rem;
    color: var(--fg-muted);
  }
</style>
