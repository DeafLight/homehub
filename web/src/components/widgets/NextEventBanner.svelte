<script lang="ts">
  import type { CalendarEvent } from '../../../../shared/types.ts';
  import { mix } from '../../lib/color.ts';
  import { eventLine } from '../../lib/format.ts';
  import DetailLink from '../DetailLink.svelte';
  import Icon from '../Icon.svelte';

  type Props = { event: CalendarEvent | null; color: string; now: Date };
  let { event, color, now }: Props = $props();

  // Fond teinté de la couleur du profil ; textes éclaircis pour rester lisibles dessus.
  const background = $derived(mix(color, '#0f1115', 0.28));
  const accent = $derived(mix(color, '#ffffff', 0.55));
</script>

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
    <span class="chevron"><Icon name="chevron" size={40} color={accent} strokeWidth={2} /></span>
  </span>
</DetailLink>

<style>
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
