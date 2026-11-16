<script lang="ts">
  // Bandeau « Prochaine activité » d'un tableau de bord de la tablette (lien vers la semaine détaillée). Si le lieu du
  // rendez-vous est reconnu (`routable`), un bouton « Trajet » à côté ouvre son trajet (`onTrip`).
  import { eventKey } from '../../../../shared/trip.ts';
  import type { CalendarEvent } from '../../../../shared/types.ts';
  import { mix } from '../../lib/color.ts';
  import { eventLine } from '../../lib/format.ts';
  import DetailLink from '../DetailLink.svelte';
  import Icon from '../Icon.svelte';

  type Props = { event: CalendarEvent | null; color: string; now: Date; routable?: ReadonlySet<string>; onTrip?: (key: string, title: string) => void };
  let { event, color, now, routable = new Set(), onTrip }: Props = $props();
  const tripKey = $derived(event && onTrip && routable.has(eventKey(event)) ? eventKey(event) : null);

  // Fond teinté de la couleur du profil ; textes éclaircis pour rester lisibles dessus.
  const background = $derived(mix(color, '#0f1115', 0.28));
  const accent = $derived(mix(color, '#ffffff', 0.55));
</script>

<div class="wrap">
<DetailLink to="week" label="Semaine détaillée" variant="block">
  <span class="banner" style:background>
    <Icon name="clock" size={72} color={accent} strokeWidth={1.6} />
    <span class="text">
      <span class="label" style:color={accent}>Prochaine activité</span>
      {#if event}
        <span class="title">{eventLine(event, now)}</span>
        {#if event.location}
          <span class="detail">{event.location}</span>
        {/if}
      {:else}
        <span class="title">Rien de prévu cette semaine</span>
      {/if}
    </span>
    {#if tripKey}<span class="trip-room"></span>{/if}
    <span class="chevron"><Icon name="chevron" size={40} color={accent} strokeWidth={2} /></span>
  </span>
</DetailLink>
{#if tripKey && event}
  <!-- Hors du lien (pas de bouton dans un lien) : posé sur le bandeau, à gauche du chevron. -->
  <button type="button" class="trip" aria-label="{event.title} : voir le trajet" onclick={() => onTrip?.(tripKey, event.title)}>
    <Icon name="bus" size={26} /> Trajet
  </button>
{/if}
</div>

<style>
  .wrap {
    position: relative;
  }

  /* Place laissée au bouton « Trajet » dans le bandeau. */
  .trip-room {
    flex: none;
    width: 150px;
    margin-left: auto;
  }

  .trip {
    position: absolute;
    top: 50%;
    right: 100px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border: 0;
    border-radius: 999px;
    background: var(--rain-bg);
    color: var(--rain-soft);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 700;
    transform: translateY(-50%);
    cursor: pointer;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 32px;
    padding: 28px 36px;
    border-radius: var(--radius-xl);
  }

  .chevron {
    display: flex;
    margin-left: auto;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .label {
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .title {
    font-size: 2.4rem;
    font-weight: 600;
    line-height: 1.15;
  }

  .detail {
    font-size: 1.25rem;
    color: var(--fg-soft);
  }
</style>
