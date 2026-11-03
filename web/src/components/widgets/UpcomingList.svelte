<script lang="ts">
  import type { CalendarEvent } from '../../../../shared/types.ts';
  import { formatEventWhen } from '../../lib/format.ts';
  import Card from '../Card.svelte';

  type Props = { events: CalendarEvent[]; now: Date };
  let { events, now }: Props = $props();
</script>

<Card title="Cette semaine" link={{ to: 'week', label: 'Semaine détaillée' }}>
  {#if events.length === 0}
    <p class="empty">Rien d’autre de prévu</p>
  {:else}
    <ul>
      {#each events as event (event.id)}
        <li>
          <span>{event.title}</span>
          <span class="when">{formatEventWhen(event, now)}</span>
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
