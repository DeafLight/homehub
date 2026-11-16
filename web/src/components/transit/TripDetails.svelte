<script lang="ts">
  // Corps d'un trajet (« Prochain trajet » de l'accueil du téléphone, trajet d'un rendez-vous touché dans l'agenda du
  // téléphone ou de la tablette) : rendez-vous visé, heure de partir en gros, étapes en pastilles, retard, autre choix,
  // ligne voiture et Google Maps (si présente), et d'où le calcul part. En tête, le titre et « temps réel ». Affichage seul : textes dans lib/next-trip.ts.
  import type { NextTrip } from '../../../../shared/trip.ts';
  import { carLine, delayLine, destinationLine, hourText, leaveLine, leaveTitle, legChips, originLine, otherLine } from '../../lib/next-trip.ts';
  import Icon from '../Icon.svelte';

  /** `label` : titre de la carte (« Prochain trajet », « Trajet »). */
  type Props = { trip: NextTrip; now: Date; label: string };
  let { trip, now, label }: Props = $props();

  const ICONS = { walk: 'walk', bus: 'bus', tram: 'tram', rail: 'tram' } as const;
  const soon = $derived(trip.transit ? Date.parse(trip.transit.leaveAt) - now.getTime() <= 5 * 60_000 : false);
</script>

<div class="head">
  <h2 class="card-label">{label}</h2>
  {#if trip.transit?.realtime}<span class="live"><Icon name="live" size={16} /> temps réel</span>{/if}
</div>
<p class="where">{destinationLine(trip.destination, now)}</p>

{#if trip.transit}
  <p class="leave" class:soon class:late={trip.late}>{leaveTitle(trip.transit.leaveAt, now)}</p>
  <p class="times">{leaveLine(trip.transit, now)}</p>
  {#if trip.late}<p class="warn">Tu arriveras après {hourText(new Date(trip.arriveBy))}, l’heure visée.</p>{/if}
  <ol class="legs">
    {#each legChips(trip.transit) as chip, i (i)}
      <li class="chip {chip.mode}" class:cancelled={chip.cancelled}>
        <Icon name={ICONS[chip.mode]} size={18} />
        <span>{chip.text}</span>
        {#if chip.delay}<span class="delay">{chip.delay}</span>{/if}
      </li>
    {/each}
  </ol>
  {#if delayLine(trip.transit)}<p class="warn">{delayLine(trip.transit)}</p>{/if}
  {#if otherLine(trip)}<p class="other">{otherLine(trip)}</p>{/if}
{:else}
  <p class="times">Pas d’itinéraire trouvé en bus ou en tram.</p>
{/if}

{#if trip.car}
  {@const car = carLine(trip.car)}
  <div class="car">
    <p class="car-head"><span class="car-time"><Icon name="car" size={18} /> {car.minutes}</span> <strong>{car.leave}</strong></p>
    <span class="car-detail">{car.detail}</span>
    <a class="maps" href={car.url} target="_blank" rel="noopener noreferrer">Google Maps ↗</a>
  </div>
{/if}

<p class="other origin"><Icon name={trip.from === 'position' ? 'pin' : 'home'} size={16} /> {originLine(trip)}</p>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .live {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--ok-bg);
    color: var(--ok-fg);
    font-size: 0.85rem;
    font-weight: 600;
  }

  p {
    margin: 0;
  }

  .where {
    margin-top: 6px;
    color: var(--fg-soft);
    font-weight: 600;
  }

  .leave {
    margin-top: 10px;
    font-size: 2.1rem;
    font-weight: 800;
    line-height: 1.1;
  }

  .leave.soon {
    color: var(--sun);
  }

  .leave.late {
    color: var(--bad);
  }

  .times {
    margin-top: 4px;
    color: var(--fg-muted);
  }

  .legs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 0.95rem;
  }

  .chip:not(:last-child)::after {
    content: '›';
    margin-left: 4px;
    color: var(--fg-muted);
  }

  .chip.bus,
  .chip.tram,
  .chip.rail {
    background: var(--rain-bg);
    color: var(--rain-soft);
    font-weight: 600;
  }

  .chip.cancelled span {
    text-decoration: line-through;
  }

  .delay {
    color: var(--warn);
  }

  .warn {
    margin-top: 8px;
    color: var(--warn);
    font-weight: 600;
  }

  .other {
    margin-top: 10px;
    color: var(--fg-muted);
    font-size: 0.95rem;
  }

  .origin {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Ligne voiture : durée et heure de départ, puis trafic et distance à côté du bouton Google Maps. */
  .car {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px 12px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--surface-2);
  }

  .car-head {
    display: flex;
    grid-column: 1 / -1;
    align-items: center;
    gap: 10px;
    font-size: 1.1rem;
  }

  .car-time {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--warn-bg);
    color: var(--warn);
    font-weight: 700;
  }

  .car-detail {
    color: var(--fg-muted);
    font-size: 0.9rem;
  }

  .maps {
    padding: 8px 12px;
    border-radius: 12px;
    background: var(--surface-2);
    color: var(--fg);
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
  }
</style>
