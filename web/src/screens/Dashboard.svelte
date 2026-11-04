<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Note, Task } from '../../../shared/types.ts';
  import Icon from '../components/Icon.svelte';
  import NoteForm from '../components/NoteForm.svelte';
  import ProfileRail from '../components/ProfileRail.svelte';
  import DetailLink from '../components/DetailLink.svelte';
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
  import { formatTemperature, weatherIcon, weatherIconColor, weatherLabel } from '../lib/weather.ts';

  const DASHBOARD_REFRESH_MS = 60_000;

  // App.svelte recrée ce composant à chaque changement de profil ({#key}) : ownerId est fixe ici.
  type Props = { ownerId: string };
  let { ownerId }: Props = $props();

  const { api, actor, profiles, clock, navigate } = getAppContext();
  const profile = $derived(profiles.find((p) => p.id === ownerId));
  const dashboard = createResource(() => api.dashboard(ownerId), DASHBOARD_REFRESH_MS);
  onDestroy(dashboard.destroy);

  let writing = $state(false);

  // Un mot vu disparaît tout de suite ; le suivant prend sa place. Un mot à toute la famille : un parent.
  async function seeNote(note: Note) {
    if (!(await actor.allow(note.to))) return;
    const data = dashboard.data;
    if (!data) return;
    dashboard.set({ ...data, notes: data.notes.filter((n) => n.id !== note.id) });
    try {
      await api.markNoteSeen(note.id);
    } catch {
      await dashboard.refresh();
    }
  }

  // Un mot part du profil ouvert : il faut pouvoir écrire sur ce profil.
  async function startNote() {
    if (await actor.allow(ownerId)) writing = true;
  }

  async function writeNote({ to, text }: { to: string; text: string }) {
    await api.addNote(to, text, ownerId);
    writing = false;
    await dashboard.refresh();
  }

  // Mise à jour optimiste : la case change tout de suite, et on resynchronise si le serveur refuse.
  async function toggleTask(task: Task, done: boolean) {
    if (!(await actor.allow(ownerId))) return;
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
        <span class="header-side">
          <span class="muted">{formatLongDate(clock.now)}</span>
          {#if dashboard.data?.weather}
            {@const weather = dashboard.data.weather}
            <DetailLink to="weather" label="Météo détaillée" variant="pill" chevronSize={24}>
              <Icon name={weatherIcon(weather.weatherCode, weather.isDay)} size={28} color={weatherIconColor(weather.weatherCode, weather.isDay)} />
              <span class="weather">{formatTemperature(weather.temperatureC)} {weatherLabel(weather.weatherCode).toLowerCase()}</span>
            </DetailLink>
          {/if}
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
              <NoteCard notes={data.notes} {profiles} now={clock.now} compact onSeen={seeNote} onWrite={startNote} />
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
            <NoteCard notes={data.notes} {profiles} now={clock.now} onSeen={seeNote} onWrite={startNote} />
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

{#if writing && profile}
  <div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (writing = false)}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Laisser un mot">
      <NoteForm from={profile} profiles={profiles.filter((p) => p.id !== ownerId)} onSubmit={writeNote} onCancel={() => (writing = false)} />
    </div>
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
    align-items: center;
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

  .header-side {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .weather {
    font-size: 1.3rem;
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
    grid-template-rows: auto minmax(0, 1fr) auto;
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

  .overlay {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 60%);
  }

  .dialog {
    width: min(620px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    box-sizing: border-box;
    padding: 28px;
    border-radius: var(--radius-xl);
    background: var(--surface);
    overflow-y: auto;
  }
</style>
