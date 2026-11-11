<script lang="ts">
  import { type HolidayStatus, holidayText } from '../../../shared/school-holidays.ts';
  import Icon from './Icon.svelte';

  // Puce discrète des vacances scolaires (accueil, dashboards, agenda du téléphone) : « Vacances de Noël dans
  // 12 jours », « Dernier jour avant les vacances de Noël », « Vacances de Noël · reprise lundi 4 janvier ».
  // Jours fériés aussi : « Férié · 11 novembre », la veille « Demain férié · Ascension » (« Lundi férié · … » un
  // vendredi). Le texte vient de shared/school-holidays.ts ; un jour sans école (vacances, férié), la puce passe en
  // couleur « soleil ».
  type Props = { holiday: HolidayStatus; size?: 'small' | 'large' };
  let { holiday, size = 'large' }: Props = $props();
  const off = $derived(holiday.kind === 'during' || holiday.kind === 'public-holiday');
  const eve = $derived(holiday.kind === 'last-day' || holiday.kind === 'public-holiday-next');
</script>

<span class="chip {size}" class:during={off} class:last={eve}>
  <Icon name={off ? 'sun' : 'school'} size={size === 'large' ? 24 : 18} />
  <span>{holidayText(holiday)}</span>
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
    max-width: 100%;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .large {
    min-height: 44px;
    padding: 0 18px 0 14px;
    font-size: var(--text-small);
  }

  .small {
    min-height: 32px;
    padding: 0 14px 0 10px;
    font-size: 0.95rem;
  }

  .chip :global(svg) {
    flex-shrink: 0;
    color: var(--fg-muted);
  }

  .during {
    background: var(--warn-bg);
    color: var(--fg);
  }

  .during :global(svg),
  .last :global(svg) {
    color: var(--sun);
  }
</style>
