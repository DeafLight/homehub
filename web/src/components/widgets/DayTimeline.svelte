<script lang="ts">
  // Frise d'une journée : cours (gris, pointillés, toque) et agenda (couleur du profil, calendrier) à leur heure.
  import { mix } from '../../lib/color.ts';
  import { type DayPlan, startOfDay, timelinePercent, whenOnDay } from '../../lib/day.ts';
  import { formatTime } from '../../lib/format.ts';
  import type { Snippet } from 'svelte';
  import Card from '../Card.svelte';
  import Icon from '../Icon.svelte';

  type Props = {
    title: string;
    day: Date;
    plan: DayPlan;
    /** Plage horaire, commune aux frises affichées côte à côte pour qu'elles s'alignent. */
    hours: { startHour: number; endHour: number };
    /** Lignes réservées aux événements sur la journée : les frises voisines restent alignées. */
    allDayRows: number;
    now: Date;
    color: string;
    /** En tête de carte, à la place du titre (bascule aujourd'hui / demain du dashboard focus). */
    header?: Snippet;
  };
  let { title, day, plan, hours, allDayRows, now, color, header }: Props = $props();

  const accentBg = $derived(mix(color, '#0f1115', 0.3));
  const accentLight = $derived(mix(color, '#ffffff', 0.55));

  const marks = $derived.by(() => {
    const step = hours.endHour - hours.startHour > 8 ? 2 : 1;
    const result: number[] = [];
    for (let h = hours.startHour; h <= hours.endHour; h += step) result.push(h);
    return result;
  });
  const top = (date: Date) => timelinePercent(date, hours.startHour, hours.endHour);
  const markTop = (hour: number) => ((hour - hours.startHour) / (hours.endHour - hours.startHour)) * 100;
  const isToday = $derived(startOfDay(day).getTime() === startOfDay(now).getTime());
  const nowVisible = $derived(isToday && now.getHours() >= hours.startHour && now.getHours() < hours.endHour);
</script>

<Card title={header ? undefined : title} link={{ to: 'week', label: 'Semaine détaillée' }}>
  {#if header}{@render header()}{/if}
  {#if allDayRows > 0}
    <ul class="all-day">
      {#each plan.allDay as event (event.id)}
        <li style:background={accentBg}>
          <Icon name="calendar" size={18} color={accentLight} />
          <span class="title">{event.title}</span>
          <span class="meta" style:color={accentLight}>{whenOnDay(event, day)}</span>
        </li>
      {/each}
      {#each { length: allDayRows - plan.allDay.length } as _, i (i)}
        <li class="filler" aria-hidden="true"><Icon name="calendar" size={18} /><span>&nbsp;</span></li>
      {/each}
    </ul>
  {/if}

  {#if plan.items.length === 0}
    <p class="empty">Ni cours ni activité</p>
  {:else}
    <div class="timeline">
      <div class="hours" aria-hidden="true">
        {#each marks as hour (hour)}
          <span style:top="{markTop(hour)}%">{String(hour).padStart(2, '0')}:00</span>
        {/each}
      </div>
      <div class="track">
        {#each marks as hour (hour)}
          <div class="line" style:top="{markTop(hour)}%"></div>
        {/each}
        {#each plan.items as item (item.id)}
          <div
            class="block {item.kind}"
            class:past={item.end <= now}
            class:cancelled={item.cancelled}
            style:top="{top(item.start)}%"
            style:height="calc({top(item.end) - top(item.start)}% - 4px)"
            style:background={item.kind === 'event' ? accentBg : undefined}
          >
            <Icon
              name={item.kind === 'course' ? 'school' : 'calendar'}
              size={18}
              color={item.kind === 'course' ? 'var(--fg-muted)' : accentLight}
            />
            <span class="title">
              {item.title}{#if item.cancelled}<span class="badge">annulé</span>{/if}
            </span>
            <!-- Cours : l'heure se lit sur l'axe, on garde la salle. Agenda : l'heure, en couleur. -->
            <span class="meta" style:color={item.kind === 'event' ? accentLight : undefined}>
              {item.kind === 'course' ? (item.room ?? '') : formatTime(item.start)}
            </span>
          </div>
        {/each}
        {#if nowVisible}
          <div class="now" style:top="{top(now)}%" style:background={color}>
            <span style:background={color}>{formatTime(now)}</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</Card>

<style>
  .all-day {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .all-day li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-radius: 12px;
    font-size: 1.1rem;
  }

  .filler {
    visibility: hidden;
  }

  .timeline {
    flex-grow: 1;
    min-height: 0;
    display: flex;
    gap: 12px;
    padding: 10px 0;
  }

  .hours {
    position: relative;
    width: 48px;
    flex-shrink: 0;
  }

  .hours span {
    position: absolute;
    right: 0;
    transform: translateY(-50%);
    font-size: 0.95rem;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .track {
    position: relative;
    flex-grow: 1;
  }

  .line {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--surface-2);
  }

  .block {
    position: absolute;
    left: 0;
    right: 0;
    min-height: 26px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    border-radius: 12px;
    overflow: hidden;
    font-size: 1.1rem;
  }

  .block.course {
    background: #1f232b;
    border: 1px dashed #3a404b;
    color: #c9ced6;
  }

  .block.event .title {
    font-weight: 700;
    color: #ffffff;
  }

  .title {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    flex-shrink: 0;
    font-size: 0.95rem;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .past {
    opacity: 0.45;
  }

  .cancelled .title {
    text-decoration: line-through;
  }

  .badge {
    display: inline-block;
    margin-left: 8px;
    font-size: 0.85rem;
    color: var(--fg-muted);
  }

  .now {
    position: absolute;
    left: -6px;
    right: 0;
    height: 2px;
  }

  .now span {
    position: absolute;
    right: 0;
    top: -11px;
    padding: 1px 8px;
    border-radius: 999px;
    color: #0f1115;
    font-size: 0.85rem;
    font-weight: 700;
  }

  .empty {
    margin: 0;
    font-size: 1.3rem;
    color: var(--fg-muted);
  }
</style>
