<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Task } from '../../../shared/types.ts';
  import ProfileRail from '../components/ProfileRail.svelte';
  import DayTimeline from '../components/widgets/DayTimeline.svelte';
  import NextEventBanner from '../components/widgets/NextEventBanner.svelte';
  import NoteCard from '../components/widgets/NoteCard.svelte';
  import TaskList from '../components/widgets/TaskList.svelte';
  import UpcomingList from '../components/widgets/UpcomingList.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { addDays, dayPlan, eventsAfter, timelineHours } from '../lib/day.ts';
  import { formatLongDate, greeting } from '../lib/format.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { HOME_PATH } from '../lib/route.ts';
  import { formatTemperature, weatherLabel } from '../lib/weather.ts';

  const DASHBOARD_REFRESH_MS = 60_000;

  // App.svelte recrée ce composant à chaque changement de profil ({#key}) : ownerId est fixe ici.
  type Props = { ownerId: string };
  let { ownerId }: Props = $props();

  const { api, profiles, clock, navigate } = getAppContext();
  const profile = $derived(profiles.find((p) => p.id === ownerId));
  const dashboard = createResource(() => api.dashboard(ownerId), DASHBOARD_REFRESH_MS);
  onDestroy(dashboard.destroy);

  const authorName = $derived(profiles.find((p) => p.id === dashboard.data?.note?.authorId)?.name ?? null);

  // Mise à jour optimiste : la case change tout de suite, et on resynchronise si le serveur refuse.
  async function toggleTask(task: Task, done: boolean) {
    const data = dashboard.data;
    if (!data) return;
    dashboard.set({ ...data, tasks: data.tasks.map((t) => (t.id === task.id ? { ...t, done } : t)) });
    try {
      await api.setTaskDone(ownerId, task.id, done);
    } catch {
      await dashboard.refresh();
    }
  }
</script>

{#if profile}
  <div class="dashboard">
    <ProfileRail currentId={profile.id} />

    <main>
      <header>
        <h1>{profile.isFamily ? profile.name : `${greeting(clock.now)} ${profile.name} !`}</h1>
        <span class="muted">
          {formatLongDate(clock.now)}{#if dashboard.data?.weather}{` · ${formatTemperature(
              dashboard.data.weather.temperatureC,
            )} ${weatherLabel(dashboard.data.weather.weatherCode).toLowerCase()}`}{/if}
        </span>
      </header>

      {#if dashboard.data}
        {@const data = dashboard.data}
        {#if data.school}
          <!-- Profil avec emploi du temps : frises d'aujourd'hui et de demain (cours + agenda), puis la suite. -->
          {@const tomorrow = addDays(clock.now, 1)}
          {@const today = dayPlan(data.school.today, data.events, clock.now)}
          {@const next = dayPlan(data.school.tomorrow, data.events, tomorrow)}
          {@const hours = timelineHours([...today.items, ...next.items])}
          {@const allDayRows = Math.max(today.allDay.length, next.allDay.length)}
          <div class="grid school">
            <DayTimeline title="Aujourd’hui" day={clock.now} plan={today} {hours} {allDayRows} now={clock.now} color={profile.color} />
            <DayTimeline title="Demain" day={tomorrow} plan={next} {hours} {allDayRows} now={clock.now} color={profile.color} />
            <div class="column">
              <UpcomingList events={eventsAfter(data.events, tomorrow).slice(0, 4)} now={clock.now} />
              <TaskList title="Mes tâches" tasks={data.tasks} color={profile.color} onToggle={toggleTask} />
            </div>
          </div>
        {:else}
          <NextEventBanner event={data.nextEvent} color={profile.color} now={clock.now} />
          <div class="grid">
            <TaskList
              title={profile.isFamily ? 'Liste de courses' : 'Mes tâches'}
              tasks={data.tasks}
              color={profile.color}
              onToggle={toggleTask}
            />
            <UpcomingList events={data.upcoming} now={clock.now} />
            <NoteCard note={data.note} {authorName} />
          </div>
        {/if}
      {:else if dashboard.error}
        <p class="muted">Impossible de charger le dashboard : {dashboard.error}</p>
      {/if}
    </main>
  </div>
{:else}
  <div class="unknown">
    <p>Ce profil n’existe plus.</p>
    <button type="button" onclick={() => navigate(HOME_PATH)}>Retour à l’accueil</button>
  </div>
{/if}

<style>
  .dashboard {
    height: 100%;
    display: flex;
  }

  main {
    flex-grow: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 36px 48px;
    box-sizing: border-box;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 24px;
  }

  h1 {
    margin: 0;
    font-size: 3rem;
    font-weight: 600;
  }

  .muted {
    font-size: 1.4rem;
    color: var(--fg-muted);
  }

  .grid {
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
  }

  .grid.school {
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1.25fr) minmax(0, 0.9fr);
  }

  .column {
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 20px;
  }

  .unknown {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
    font-size: 1.6rem;
  }

  .unknown button {
    min-height: 64px;
    padding: 0 32px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
</style>
