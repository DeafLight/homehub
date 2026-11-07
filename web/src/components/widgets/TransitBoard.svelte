<script lang="ts">
  import type { TransitData } from '../../../../shared/types.ts';
  import Icon from '../Icon.svelte';
  import { departureRows, departureText, isTram } from '../../lib/transit.ts';

  // Prochains passages Irigo aux arrêts suivis (accueil, piste A) : une seule ligne par arrêt, une pastille par ligne et
  // destination avec son prochain passage ; le point vert dit que l'heure vient du temps réel. La hauteur ne dépend
  // plus du nombre de passages annoncés. Perturbations des lignes suivies en dessous, deux au plus.
  type Props = { transit: TransitData; now: Date; chips?: number };
  let { transit, now, chips = 3 }: Props = $props();
</script>

<div class="board">
  {#each transit.stops as stop (stop.id)}
    {@const rows = departureRows(stop.departures, now, 1).slice(0, chips)}
    <div class="stop">
      <span class="stop-name">{stop.label}</span>
      {#if rows.length === 0}
        <span class="none">Aucun passage dans l’heure</span>
      {:else}
      <span class="chips">
        {#each rows as row (`${row.line}→${row.destination}`)}
          {@const d = row.next[0]}
          <span class="chip">
            <span class="line" class:tram={isTram(row.line)}>{row.line}</span>
            <span class="destination">{row.destination}</span>
            <span class="time">{departureText(d, now)}</span>
            {#if d.realtime}<span class="live" aria-label="temps réel"></span>{/if}
          </span>
        {/each}
      </span>
      {/if}
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
    gap: var(--space-1);
  }

  .stop {
    display: grid;
    grid-template-columns: 9rem minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
  }

  .stop-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--text-small);
    color: var(--fg-soft);
  }

  .none {
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  /* Les pastilles restent sur une ligne : celles qui ne tiennent pas sont masquées plutôt que d'agrandir le bloc. */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    height: 44px;
    overflow: hidden;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
    height: 44px;
    padding: 0 14px 0 6px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: var(--text-body);
  }

  .line {
    display: grid;
    place-items: center;
    min-width: 32px;
    height: 32px;
    padding: 0 6px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--rain-bg);
    color: var(--rain-soft);
    font-size: 1.05rem;
    font-weight: 700;
  }

  .line.tram {
    background: #3a1f30;
    color: #f4b8d6;
  }

  .destination {
    max-width: 7.5em;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .time {
    white-space: nowrap;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .live {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--ok);
  }

  .alert {
    display: flex;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-1) 12px;
    border-radius: var(--radius-sm);
    background: var(--warn-bg);
    color: var(--warn);
    font-size: 1rem;
  }
</style>
