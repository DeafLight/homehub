<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { DashboardData, Note, Task } from '../../../shared/types.ts';
  import { addDays, dayPlan, timelineHours } from '../lib/day.ts';
  import { focusCard, focusTiles, type TileKind, timelineDay } from '../lib/focus.ts';
  import type { Profile } from '../lib/profiles.ts';
  import { routineFooter, routineTitle } from '../lib/routine.ts';
  import DayTimeline from './widgets/DayTimeline.svelte';
  import HomeworkCard from './widgets/HomeworkCard.svelte';
  import NoteCard from './widgets/NoteCard.svelte';
  import TaskList from './widgets/TaskList.svelte';
  import UpcomingList from './widgets/UpcomingList.svelte';

  // Dashboard « focus » d'un élève : une seule frise (aujourd'hui, ou demain une fois la journée finie, au choix d'un
  // toucher), la carte du moment en grand (routine, devoirs ou rendez-vous selon l'heure), et le reste en tuiles :
  // une tuile ouvre sa carte complète dans un panneau à droite, refermé d'un toucher à côté ou seul après 30 s.
  const PANEL_IDLE_MS = 30_000;

  type Props = {
    data: DashboardData & { school: NonNullable<DashboardData['school']> };
    profile: Profile;
    profiles: Profile[];
    now: Date;
    onToggleTask(task: Task, done: boolean): void;
    onToggleRoutine(item: Task, done: boolean): void;
    onSeenNote(note: Note): void;
    onWriteNote(): void;
  };
  let { data, profile, profiles, now, onToggleTask, onToggleRoutine, onSeenNote, onWriteNote }: Props = $props();

  const tomorrow = $derived(addDays(now, 1));
  const todayPlan = $derived(dayPlan(data.school.today, data.events, now));
  const tomorrowPlan = $derived(dayPlan(data.school.tomorrow, data.events, tomorrow));
  /** Jour choisi d'un toucher ; sinon celui que l'heure désigne. */
  let chosen = $state<'today' | 'tomorrow' | null>(null);
  const shown = $derived(chosen ?? timelineDay(todayPlan, now));
  const plan = $derived(shown === 'today' ? todayPlan : tomorrowPlan);

  const focus = $derived(focusCard(data, now));
  const nameOf = (ownerId: string | null) => profiles.find((p) => p.id === ownerId)?.name;
  const tiles = $derived(focusTiles(data, now, nameOf));
  const upcoming = $derived(data.events.filter((e) => new Date(e.start) >= now).slice(0, 6));

  let open = $state<TileKind | null>(null);
  let idle: ReturnType<typeof setTimeout> | undefined;
  function keepOpen() {
    clearTimeout(idle);
    idle = setTimeout(() => (open = null), PANEL_IDLE_MS);
  }
  function show(kind: TileKind) {
    open = open === kind ? null : kind;
    if (open) keepOpen();
    else clearTimeout(idle);
  }
  onDestroy(() => clearTimeout(idle));
</script>

{#snippet switcher()}
  <div class="switch" role="group" aria-label="Jour affiché">
    <button type="button" class:on={shown === 'today'} aria-pressed={shown === 'today'} onclick={() => (chosen = 'today')}>Aujourd’hui</button>
    <button type="button" class:on={shown === 'tomorrow'} aria-pressed={shown === 'tomorrow'} onclick={() => (chosen = 'tomorrow')}>Demain</button>
  </div>
{/snippet}

{#snippet card(kind: TileKind, compact: boolean)}
  {#if kind === 'routine' && data.routine}
    <TaskList
      title={routineTitle(data.routine)}
      tasks={data.routine.items}
      color={profile.color}
      linked={false}
      footer={routineFooter(data.routine)}
      onToggle={onToggleRoutine}
    />
  {:else if kind === 'homework' && data.homework}
    <HomeworkCard homework={data.homework} {now} color={profile.color} {compact} />
  {:else if kind === 'tasks'}
    <TaskList title="Mes tâches" tasks={data.tasks} color={profile.color} onToggle={onToggleTask} />
  {:else if kind === 'notes'}
    <NoteCard
      notes={data.notes}
      {profiles}
      {now}
      onSeen={onSeenNote}
      onWrite={() => {
        open = null;
        onWriteNote();
      }}
    />
  {:else}
    <UpcomingList events={upcoming} {now} />
  {/if}
{/snippet}

<div class="focus" style:--accent={profile.color}>
  <DayTimeline
    title={shown === 'today' ? 'Aujourd’hui' : 'Demain'}
    day={shown === 'today' ? now : tomorrow}
    {plan}
    hours={timelineHours(plan.items)}
    allDayRows={plan.allDay.length}
    {now}
    color={profile.color}
    header={switcher}
  />

  <div class="moment">{@render card(focus, false)}</div>

  <div class="tiles">
    {#each tiles as tile (tile.kind)}
      <button type="button" class="tile" class:highlight={tile.highlight} class:open={open === tile.kind} onclick={() => show(tile.kind)}>
        <span class="value">{tile.value}</span>
        <span class="label">{tile.label}</span>
      </button>
    {/each}
  </div>

  {#if open}
    <div class="scrim" role="presentation" onclick={() => (open = null)}></div>
    <aside class="panel" onpointerdown={keepOpen}>{@render card(open, false)}</aside>
  {/if}
</div>

<style>
  .focus {
    position: relative;
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 0.62fr);
    gap: 20px;
  }

  .moment {
    min-height: 0;
    display: grid;
  }

  .switch {
    display: inline-flex;
    align-self: flex-start;
    border-radius: 16px;
    background: var(--surface-2);
    padding: 4px;
  }

  .switch button {
    min-height: 48px;
    padding: 0 20px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-size: 1.3rem;
    font-weight: 600;
    cursor: pointer;
  }

  .switch button.on {
    background: var(--bg);
    color: var(--fg);
  }

  .tiles {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    flex: 1 1 0;
    max-height: 150px;
    min-height: 0;
    justify-content: center;
    padding: 12px 20px;
    border: 2px solid transparent;
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }

  .tile.highlight {
    border-color: var(--accent);
  }

  .tile.open {
    background: var(--surface-2);
  }

  .value {
    max-width: 100%;
    font-size: 2.2rem;
    font-weight: 700;
    line-height: 1.1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .label {
    max-width: 100%;
    font-size: 1.1rem;
    color: var(--fg-muted);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .scrim {
    position: absolute;
    inset: 0;
    z-index: 2;
    background: rgb(0 0 0 / 55%);
    border-radius: var(--radius-lg);
  }

  .panel {
    position: absolute;
    z-index: 3;
    top: 0;
    right: 0;
    bottom: 0;
    width: 46%;
    display: grid;
    border-radius: var(--radius-lg);
    outline: 1px solid var(--border-strong);
    background: var(--surface);
  }
</style>
