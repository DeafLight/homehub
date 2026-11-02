<script lang="ts">
  // Résumé d'un jour : les cours regroupés dans un bloc « Collège », puis les événements de l'agenda.
  import type { CalendarEvent, SchoolCourse } from '../../../../shared/types.ts';
  import { mix } from '../../lib/color.ts';
  import { whenOnDay } from '../../lib/day.ts';
  import { formatTime } from '../../lib/format.ts';
  import Card from '../Card.svelte';
  import Icon from '../Icon.svelte';

  type Props = { title: string; day: Date; courses: SchoolCourse[]; events: CalendarEvent[]; color: string };
  let { title, day, courses, events, color }: Props = $props();

  const accentBg = $derived(mix(color, '#0f1115', 0.3));
  const accentLight = $derived(mix(color, '#ffffff', 0.55));
  const schoolHours = $derived(
    courses.length > 0
      ? `${formatTime(new Date(courses[0].start))} – ${formatTime(new Date(courses[courses.length - 1].end))}`
      : '',
  );
</script>

<Card {title}>
  {#if courses.length === 0 && events.length === 0}
    <p class="empty">Ni cours ni activité</p>
  {/if}

  {#if courses.length > 0}
    <div class="school">
      <div class="school-header">
        <Icon name="school" size={20} color="var(--fg-muted)" />
        <span class="school-title">Collège</span>
        <span class="muted">{schoolHours}</span>
      </div>
      <ul>
        {#each courses as course (course.id)}
          <li class:cancelled={course.cancelled}>
            <span class="time">{formatTime(new Date(course.start))}</span>
            <span class="subject">
              {course.subject}{#if course.cancelled}<span class="badge">annulé</span>{/if}
            </span>
            {#if course.room}<span class="muted">{course.room}</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#each events as event (event.id)}
    <div class="event" style:background={accentBg}>
      <Icon name="calendar" size={20} color={accentLight} />
      <span class="time" style:color={accentLight}>
        {whenOnDay(event, day)}
      </span>
      <span class="event-title">{event.title}</span>
    </div>
  {/each}
</Card>

<style>
  .school {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 16px;
    border-radius: 16px;
    background: #1f232b;
    border: 1px dashed #3a404b;
    min-height: 0;
    overflow-y: auto;
  }

  .school-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 4px;
  }

  .school-title {
    font-size: 1.15rem;
    font-weight: 600;
    color: #c9ced6;
  }

  .school-header .muted {
    margin-left: auto;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 3px 0;
    font-size: 1.05rem;
  }

  .time {
    flex-shrink: 0;
    min-width: 48px;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .subject {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #c9ced6;
  }

  .muted {
    flex-shrink: 0;
    color: var(--fg-muted);
  }

  .cancelled .subject {
    text-decoration: line-through;
  }

  .badge {
    display: inline-block;
    margin-left: 8px;
    font-size: 0.85rem;
    color: var(--fg-muted);
  }

  .event {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: 16px;
    font-size: 1.15rem;
  }

  .event-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
    color: #ffffff;
  }

  .empty {
    margin: 0;
    font-size: 1.3rem;
    color: var(--fg-muted);
  }
</style>
