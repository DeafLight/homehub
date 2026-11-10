<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Note, Routine, Task } from '../../../shared/types.ts';
  import Icon from '../components/Icon.svelte';
  import NoteForm from '../components/NoteForm.svelte';
  import ProfileRail from '../components/ProfileRail.svelte';
  import DetailLink from '../components/DetailLink.svelte';
  import FocusDashboard from '../components/FocusDashboard.svelte';
  import CommuteCard from '../components/widgets/CommuteCard.svelte';
  import DayTimeline from '../components/widgets/DayTimeline.svelte';
  import HomeworkCard from '../components/widgets/HomeworkCard.svelte';
  import NextEventBanner from '../components/widgets/NextEventBanner.svelte';
  import NoteCard from '../components/widgets/NoteCard.svelte';
  import TaskList from '../components/widgets/TaskList.svelte';
  import UpcomingList from '../components/widgets/UpcomingList.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { addDays, dayPlan, eventsAfter, timelineHours } from '../lib/day.ts';
  import { formatLongDate, greeting } from '../lib/format.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { dashboardLayout } from '../lib/layout.svelte.ts';
  import { routineFooter, routineTitle } from '../lib/routine.ts';
  import { HOME_PATH } from '../lib/route.ts';
  import { formatTemperature, weatherIcon, weatherIconColor, weatherLabel } from '../lib/weather.ts';

  const DASHBOARD_REFRESH_MS = 60_000;
  /** À partir de cette heure, la frise des élèves montre demain : la journée d'école est finie, on prépare le sac. */
  const EVENING_HOUR = 18;

  // App.svelte recrée ce composant à chaque changement de profil ({#key}) : ownerId est fixe ici.
  type Props = { ownerId: string };
  let { ownerId }: Props = $props();

  const { api, actor, config, profiles, clock, navigate } = getAppContext();
  const profile = $derived(profiles.find((p) => p.id === ownerId));
  /** Programme de sport sur ce profil : lien vers la séance du jour. */
  const sport = $derived(config.members.some((m) => m.id === ownerId && m.fitness));
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

  // Routine du moment : mêmes droits que les tâches du profil, mise à jour optimiste.
  async function toggleRoutine(item: Task, done: boolean) {
    if (!(await actor.allow(ownerId))) return;
    const data = dashboard.data;
    if (!data?.routine) return;
    dashboard.set({ ...data, routine: { ...data.routine, items: data.routine.items.map((i) => (i.id === item.id ? { ...i, done } : i)) } });
    try {
      await api.setRoutineDone(ownerId, item.id, done);
    } finally {
      await dashboard.refresh(); // jours de suite recalculés par le serveur
    }
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

{#snippet routine(current: Routine)}
  <TaskList
    title={routineTitle(current)}
    tasks={current.items}
    color={profile?.color ?? 'var(--fg)'}
    linked={false}
    footer={routineFooter(current)}
    onToggle={toggleRoutine}
  />
{/snippet}

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
          {#if sport}
            <DetailLink to="sport" label="Sport : séance du jour" variant="pill" chevronSize={24}>
              <Icon name="dumbbell" size={26} />
              <span class="weather">Sport</span>
            </DetailLink>
          {/if}
        </span>
      </header>

      {#if dashboard.data}
        {@const data = dashboard.data}
        {#if data.commute}
          <CommuteCard commute={data.commute} now={clock.now} />
        {/if}
        {#if data.school && dashboardLayout.current === 'focus'}
          <!-- Essai : dashboard « focus » (roue dentée › Dashboard élève). -->
          <FocusDashboard
            data={{ ...data, school: data.school }}
            {profile}
            {profiles}
            now={clock.now}
            onToggleTask={toggleTask}
            onToggleRoutine={toggleRoutine}
            onSeenNote={seeNote}
            onWriteNote={startNote}
          />
        {:else if data.school}
          <!-- Profil avec emploi du temps (piste A) : trois colonnes de hauteur fixe. La frise du jour (celle de demain
               à partir de 18 h), la routine et les tâches, les devoirs et les mots. Chaque carte fait défiler son
               contenu au lieu de pousser ses voisines. -->
          {@const tomorrow = addDays(clock.now, 1)}
          {@const evening = clock.now.getHours() >= EVENING_HOUR}
          {@const shown = evening ? dayPlan(data.school.tomorrow, data.events, tomorrow) : dayPlan(data.school.today, data.events, clock.now)}
          <div class="grid school">
            <DayTimeline
              title={evening ? 'Demain' : 'Aujourd’hui'}
              day={evening ? tomorrow : clock.now}
              plan={shown}
              hours={timelineHours(shown.items)}
              allDayRows={shown.allDay.length}
              now={clock.now}
              color={profile.color}
            />
            <div class="column">
              {#if data.routine}
                <div class="fit">{@render routine(data.routine)}</div>
              {/if}
              <div class="fill"><TaskList title="Mes tâches" tasks={data.tasks} color={profile.color} onToggle={toggleTask} /></div>
            </div>
            <div class="column">
              <div class="fill">
                {#if data.homework}
                  <HomeworkCard homework={data.homework} now={clock.now} color={profile.color} />
                {:else}
                  <UpcomingList events={eventsAfter(data.events, tomorrow).slice(0, 4)} now={clock.now} />
                {/if}
              </div>
              <div class="fit"><NoteCard notes={data.notes} {profiles} now={clock.now} compact onSeen={seeNote} onWrite={startNote} /></div>
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
            {#if data.routine}
              {@render routine(data.routine)}
            {:else if data.homework}
              <HomeworkCard homework={data.homework} now={clock.now} color={profile.color} />
            {:else}
              <UpcomingList events={data.upcoming} now={clock.now} />
            {/if}
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

  /* Colonnes de hauteur fixe : la carte « fit » prend sa hauteur, la carte « fill » le reste (160 px au moins) ;
     quand la place manque, la carte « fit » rétrécit et fait défiler sa liste plutôt que de rogner sa voisine. */
  .column {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .fit,
  .fill {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .fit {
    flex: 0 1 auto;
  }

  .fill {
    flex: 1 1 0;
    min-height: 160px;
  }

  .fit > :global(.card),
  .fill > :global(.card) {
    flex: 1 1 auto;
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
