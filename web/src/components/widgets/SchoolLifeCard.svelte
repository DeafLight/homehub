<script lang="ts">
  import type { SchoolLife } from '../../../../shared/types.ts';
  import type { Profile } from '../../lib/profiles.ts';
  import { attendanceText, childSummaries, gradeParts, pastDayText, toJustifyText, unreadCount, unreadText } from '../../lib/school-life.ts';
  import Avatar from '../Avatar.svelte';
  import Icon from '../Icon.svelte';

  // Bloc compact de la vie scolaire (dashboard d'un parent, téléphone d'un parent) : une ligne par enfant avec sa
  // dernière note, ses absences et retards, puis les messages non lus. Le toucher ouvre le détail.
  type Props = { life: SchoolLife; profiles: Profile[]; now: Date; onOpen: () => void };
  let { life, profiles, now, onOpen }: Props = $props();

  const summaries = $derived(childSummaries(life));
  const unread = $derived(unreadCount(life));
  const profileOf = (id: string) => profiles.find((p) => p.id === id);
</script>

<button type="button" class="card school-life" onclick={onOpen} aria-label="Vie scolaire : voir le détail">
  <span class="card-label head">Vie scolaire <Icon name="chevron" size={20} /></span>
  {#each summaries as child (child.ownerId)}
    {@const profile = profileOf(child.ownerId)}
    <span class="child">
      {#if profile}<Avatar {profile} size={36} />{/if}
      <span class="lines">
        {#if child.lastGrade}
          {@const parts = gradeParts(child.lastGrade)}
          <span class="grade"><strong>{parts.value}</strong>{parts.outOf} · {child.lastGrade.subject}</span>
          <span class="muted">{pastDayText(child.lastGrade.date, now)}{child.lastGrade.title ? ` · ${child.lastGrade.title}` : ''}</span>
        {:else}
          <span class="muted">{child.unavailable ? 'Indisponible pour l’instant' : 'Pas encore de note'}</span>
        {/if}
        {#if !child.unavailable}
          <span class="chips">
            {#if child.toJustify > 0}<span class="chip warn">{toJustifyText(child.toJustify)}</span>{/if}
            <span class="chip">{attendanceText(child)}</span>
          </span>
        {/if}
      </span>
    </span>
  {/each}
  {#if life.messages.length > 0}
    <span class="messages" class:unread={unread > 0}><Icon name="message" size={22} /> {unreadText(unread)}</span>
  {/if}
</button>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    padding: var(--space-3);
    border: 0;
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .child {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .grade {
    font-size: var(--text-body);
    color: var(--fg-soft);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .grade strong {
    font-size: var(--text-title);
    color: var(--fg);
  }

  .muted {
    font-size: var(--text-small);
    color: var(--fg-muted);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }

  .chip {
    padding: 2px 12px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
    font-size: var(--text-small);
  }

  .chip.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }

  .messages {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: var(--space-1);
    border-top: 1px solid var(--surface-2);
    font-size: var(--text-body);
    color: var(--fg-muted);
  }

  .messages.unread {
    color: var(--fg);
  }
</style>
