<script lang="ts">
  import type { TransitData } from '../../../../shared/types.ts';
  import Icon from '../Icon.svelte';
  import { departureRows, departureText, isTram } from '../../lib/transit.ts';

  // Prochains passages Irigo aux arrêts suivis (accueil) : une ligne par ligne et destination, deux passages ;
  // l'antenne verte dit que l'heure vient du temps réel. Perturbations des lignes suivies en dessous.
  type Props = { transit: TransitData; now: Date; rows?: number };
  let { transit, now, rows = 3 }: Props = $props();
</script>

<div class="board">
  {#each transit.stops as stop (stop.id)}
    {@const lines = departureRows(stop.departures, now).slice(0, rows)}
    <div class="stop">
      <span class="stop-name"><Icon name="bus" size={22} /> {stop.label}</span>
      {#if lines.length === 0}
        <span class="none">Aucun passage dans l’heure</span>
      {/if}
      {#each lines as row (`${row.line}→${row.destination}`)}
        <span class="row">
          <span class="line" class:tram={isTram(row.line)}>{row.line}</span>
          <span class="destination">{row.destination}</span>
          {#each row.next as d, i (d.at)}
            <span class="time" class:first={i === 0}>
              {departureText(d, now)}{#if d.realtime && i === 0}<span class="live" aria-label="temps réel"><Icon name="live" size={16} /></span>{/if}
            </span>
          {/each}
        </span>
      {/each}
    </div>
  {/each}
  {#each transit.alerts.slice(0, 2) as alert (alert.id)}
    <span class="alert"><Icon name="alert" size={18} /> {alert.title}</span>
  {/each}
</div>

<style>
  .board {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .stop {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .stop-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 1.1rem;
    color: var(--fg-muted);
  }

  .none {
    font-size: 1.1rem;
    color: var(--fg-muted);
  }

  .row {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto 72px;
    align-items: center;
    gap: 12px;
    font-size: 1.25rem;
  }

  .line {
    display: grid;
    place-items: center;
    height: 32px;
    border-radius: 8px;
    background: var(--rain-bg);
    color: var(--rain-soft);
    font-weight: 700;
  }

  .line.tram {
    background: #3a1f30;
    color: #f4b8d6;
  }

  .destination {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .time {
    color: var(--fg-muted);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .time.first {
    color: var(--fg);
    font-weight: 600;
  }

  .live {
    margin-left: 4px;
    color: var(--ok);
    vertical-align: 1px;
  }

  .alert {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 12px;
    background: var(--warn-bg);
    color: var(--warn);
    font-size: 1rem;
  }
</style>
