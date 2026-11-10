<script lang="ts">
  import { exerciseById, FAMILY_LABELS } from '../../../../shared/fitness-catalogue.ts';
  import { type FitnessState, PAIN_LABELS, PALIERS, RPE_LABELS } from '../../../../shared/fitness.ts';
  import { fitnessStats, STREAK_SESSIONS, type WeekStat } from '../../../../shared/fitness-stats.ts';
  import BarChart from './BarChart.svelte';
  import ExerciseAnimation from './ExerciseAnimation.svelte';
  import LineChart from './LineChart.svelte';

  // Statistiques du programme (onglet Sport du téléphone) : résumé, régularité, progression du rythme et du ressenti,
  // chaque exercice, jours de la semaine, tour de taille, et tout l'historique par mois. Calculées à partir de ce qui
  // est déjà noté ; rien à saisir ici.
  type Props = { program: FitnessState; now: Date; onOpen: (id: string) => void };
  let { program, now, onOpen }: Props = $props();

  const stats = $derived(fitnessStats(program, now));

  const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
  const weekDay = (week: string) => new Date(`${week}T12:00:00`);
  const shortWeek = (week: string) => weekDay(week).toLocaleDateString('fr-FR', { day: 'numeric', month: 'numeric' });
  const longWeek = (week: string) => `Semaine du ${weekDay(week).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const monthName = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR')} cm`;

  function duration(seconds: number) {
    const minutes = Math.round(seconds / 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  }

  const weekLabels = $derived(stats.weeks.map((w) => shortWeek(w.week)));
  const describeWeek = (w: WeekStat) => `${longWeek(w.week)} : ${w.sessions ? plural(w.sessions, 'séance') : 'pas de séance'}`;

  /** Changements de palier dans le graphique de l'effort. */
  const palierMarks = $derived.by(() => {
    const marks: { index: number; text: string }[] = [];
    let previous: number | null = null;
    stats.weeks.forEach((w, index) => {
      if (w.palier === null) return;
      if (previous !== null && w.palier !== previous) marks.push({ index, text: PALIERS[w.palier].name });
      previous = w.palier;
    });
    return marks;
  });
  const efforts = $derived(stats.weeks.map((w) => w.effort).filter((v): v is number => v !== null));
  const effortMin = $derived(Math.min(20, ...efforts));
  const effortMax = $derived(Math.max(60, ...efforts));
</script>

<div class="stats">
  <h2 class="title">Statistiques</h2>

  {#if !stats.sessions}
    <p class="muted">Pas encore de séance notée : les statistiques viendront avec la première.</p>
  {:else}
    <section class="tiles" aria-label="En résumé">
      <div class="tile">
        <span class="value">{stats.sessions}</span>
        <span class="label">séance{stats.sessions > 1 ? 's' : ''}{stats.stopped ? `, dont ${stats.stopped} arrêtée${stats.stopped > 1 ? 's' : ''}` : ''}</span>
      </div>
      <div class="tile">
        <span class="value">{duration(stats.seconds)}</span>
        <span class="label">d’entraînement, échauffement compris</span>
      </div>
      <div class="tile">
        <span class="value">{stats.streak}</span>
        <span class="label">
          semaine{stats.streak > 1 ? 's' : ''} régulière{stats.streak > 1 ? 's' : ''} d’affilée{stats.bestStreak > stats.streak ? ` (record : ${stats.bestStreak})` : ''}
        </span>
      </div>
      {#if stats.bestWeek}
        <div class="tile">
          <span class="value">{stats.bestWeek.sessions}</span>
          <span class="label">séance{stats.bestWeek.sessions > 1 ? 's' : ''} au mieux en une semaine ({shortWeek(stats.bestWeek.week)})</span>
        </div>
      {/if}
    </section>
    <p class="muted small">Semaine régulière : {STREAK_SESSIONS} séances ou plus. Temps estimé d’après le rythme ; une séance arrêtée compte en entier.</p>

    <section class="card">
      <h3>Séances par semaine</h3>
      <BarChart
        values={stats.weeks.map((w) => w.sessions)}
        labels={weekLabels}
        max={3}
        ticks={[1, 2, 3]}
        label="Séances par semaine, douze dernières semaines"
        describe={(i) => describeWeek(stats.weeks[i])}
      />
    </section>

    <section class="card">
      <h3>Cardio par semaine</h3>
      {#if stats.weeks.some((w) => w.cardio)}
        <BarChart
          values={stats.weeks.map((w) => w.cardio ?? 0)}
          labels={weekLabels}
          label="Minutes de cardio par semaine, douze dernières semaines"
          describe={(i) => `${longWeek(stats.weeks[i].week)} : ${stats.weeks[i].cardio === null ? 'pas noté' : `${stats.weeks[i].cardio} min`}`}
        />
      {:else}
        <p class="muted small">Pas encore de cardio noté (carte « Cette semaine »).</p>
      {/if}
    </section>

    <section class="card">
      <h3>Temps d’effort par exercice</h3>
      <LineChart
        values={stats.weeks.map((w) => w.effort)}
        labels={weekLabels}
        min={effortMin}
        max={effortMax}
        ticks={[30, 45, 60]}
        marks={palierMarks}
        label="Secondes d’effort de chaque semaine, avec les changements de palier"
        describe={(i) => {
          const w = stats.weeks[i];
          return w.effort === null ? `${longWeek(w.week)} : pas de séance` : `${longWeek(w.week)} : ${w.effort} s d’effort, palier ${w.palier} (${PALIERS[w.palier ?? 1].name})`;
        }}
      />
    </section>

    <section class="card">
      <h3>Ressenti moyen</h3>
      <LineChart
        values={stats.weeks.map((w) => w.rpe)}
        labels={weekLabels}
        min={1}
        max={5}
        ticks={[1, 3, 5]}
        label="Ressenti moyen de chaque semaine, de 1 (facile) à 5 (trop dur)"
        describe={(i) => {
          const w = stats.weeks[i];
          return w.rpe === null ? `${longWeek(w.week)} : pas de séance` : `${longWeek(w.week)} : ${w.rpe.toLocaleString('fr-FR')} sur 5 (${RPE_LABELS[Math.round(w.rpe)].toLowerCase()})`;
        }}
      />
      <p class="muted small">Plus bas à rythme égal : ça devient plus facile.</p>
    </section>

    <section class="card">
      <h3>Par exercice</h3>
      <ul class="exercises">
        {#each stats.exercises as e (e.id)}
          {@const exercise = exerciseById(e.id)!}
          {@const values = e.values.map((v) => v.value)}
          <li>
            <button type="button" onclick={() => onOpen(e.id)}>
              <span class="thumb"><ExerciseAnimation id={e.id} still height={36} /></span>
              <span class="text">
                <span class="family">{FAMILY_LABELS[e.family]}</span>
                <span class="name">{exercise.name}</span>
                <span class="muted small">
                  {e.times} fois{e.hard ? ` · dur ×${e.hard}` : ''}{e.easy ? ` · facile ×${e.easy}` : ''}{#each e.pains as p (p.spot)}{` · gêne ${PAIN_LABELS[p.spot].toLowerCase()} ×${p.count}`}{/each}
                </span>
              </span>
              {#if values.length >= 2}
                {@const lo = Math.min(...values)}
                {@const hi = Math.max(...values)}
                <span class="spark" aria-label={`${exercise.unit === 's' ? 'Secondes tenues' : 'Répétitions'} par tour : de ${values[0]} à ${values.at(-1)}`}>
                  <svg viewBox="0 0 60 24" aria-hidden="true">
                    <polyline points={values.map((v, i) => `${(i / (values.length - 1)) * 56 + 2},${20 - ((v - lo) / (hi - lo || 1)) * 16}`).join(' ')} />
                  </svg>
                  <span>{values.at(-1)}{exercise.unit === 's' ? ' s' : ''}</span>
                </span>
              {:else if values.length}
                <span class="spark"><span>{values[0]}{exercise.unit === 's' ? ' s' : ''}</span></span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
      <p class="muted small">Répétitions (ou secondes tenues) par tour, quand elles sont notées sur le téléphone ; la séance guidée de la tablette ne note que le ressenti.</p>
    </section>

    <section class="card">
      <h3>Jours de séance</h3>
      <BarChart
        values={stats.weekdays}
        labels={['L', 'M', 'M', 'J', 'V', 'S', 'D']}
        label="Séances par jour de la semaine"
        describe={(i) => `Le ${DAYS[i]} : ${plural(stats.weekdays[i], 'séance')}`}
      />
    </section>
  {/if}

  {#if stats.waist}
    <section class="card">
      <h3>Tour de taille</h3>
      <p>
        {stats.waist.last.toLocaleString('fr-FR')} cm : {signed(stats.waist.total)} depuis le début ({plural(stats.waist.weeks, 'semaine')} notées){#if stats.waist.recent !== null}, {signed(stats.waist.recent)} sur 4 semaines{/if}.
      </p>
    </section>
  {/if}

  {#if stats.months.length}
    <section class="card">
      <h3>Tout l’historique</h3>
      {#each stats.months as m (m.month)}
        <h4>{monthName(m.month)} · {plural(m.sessions.length, 'séance')}</h4>
        <ul class="history">
          {#each m.sessions as s (s.id)}
            <li>
              <span class="when">{formatDate(s.at)}</span>
              <span>Séance {s.session} · {s.effort}/{s.rest} · {RPE_LABELS[s.rpe].toLowerCase()}{s.stopped ? ' · arrêtée' : ''}</span>
            </li>
          {/each}
        </ul>
      {/each}
    </section>
  {/if}
</div>

<style>
  .title {
    margin: 0 0 10px;
    font-size: 1.35rem;
  }

  h3 {
    margin: 0 0 8px;
    font-size: 1.1rem;
  }

  h4 {
    margin: 12px 0 4px;
    color: var(--fg-muted);
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  p {
    margin: 0 0 8px;
  }

  .muted {
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.88rem;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 8px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--surface);
  }

  .value {
    font-size: 1.7rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .label {
    color: var(--fg-muted);
    font-size: 0.88rem;
    line-height: 1.3;
  }

  .card {
    margin: 14px 0;
    padding: 14px 16px;
    border-radius: 18px;
    background: var(--surface);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .exercises {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }

  .exercises button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: 0;
    border-radius: 12px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    text-align: left;
  }

  .thumb {
    flex: none;
    width: 48px;
    display: grid;
    place-items: center;
  }

  .text {
    flex-grow: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .family {
    color: var(--fg-muted);
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .name {
    font-weight: 600;
  }

  .spark {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
  }

  .spark svg {
    width: 60px;
    height: 24px;
  }

  .spark polyline {
    fill: none;
    stroke: var(--rain);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .history li {
    display: flex;
    gap: 10px;
    padding: 4px 0;
    font-size: 0.95rem;
  }

  .when {
    flex: none;
    width: 92px;
    color: var(--fg-muted);
  }
</style>
