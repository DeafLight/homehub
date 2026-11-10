<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { FAMILY_LABELS } from '../../../shared/fitness-catalogue.ts';
  import { RPE_LABELS } from '../../../shared/fitness.ts';
  import { type TabletSession, totalSeconds, WARMUP, type WorkoutStep, workoutSteps } from '../../../shared/fitness-workout.ts';
  import ExerciseAnimation from '../components/fitness/ExerciseAnimation.svelte';
  import { cue } from '../lib/beep.ts';
  import { getAppContext } from '../lib/context.ts';
  import { formatMinutes } from '../lib/fitness.ts';
  import { type PageRoute, routePath } from '../lib/route.ts';

  // Séance guidée sur la tablette : échauffement, puis chaque effort avec son compte à rebours, et pendant le repos
  // l'exercice suivant. Bips sur les trois dernières secondes, au départ et à la fin de chaque effort. Rien de
  // personnel à l'écran. Pendant la séance, la personne reconnue reste retenue (ni caméra, ni retour à l'accueil, ni
  // veille : voir holdsActor) et sa session sur le serveur est prolongée ; en sortant, tout reprend, délais à zéro.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, actor, navigate } = getAppContext();

  /** Relecture de la séance : prolonge la session de la personne reconnue (faces.sessionMinutes, 1 min au moins). */
  const KEEPALIVE_MS = 30_000;
  const TICK_MS = 200;

  let plan = $state<TabletSession | null>(null);
  let steps = $state<WorkoutStep[]>([]);
  let error = $state<string | null>(null);

  let index = $state(0);
  /** Millisecondes restantes de l'étape en cours. */
  let left = $state(0);
  let paused = $state(false);
  type Phase = 'running' | 'done' | 'saved';
  let phase = $state<Phase>('running');
  let stopped = $state(false);
  let saving = $state(false);

  let endsAt = 0;
  let lastSecond = 0;

  const step = $derived(steps[index]);
  const seconds = $derived(Math.ceil(left / 1000));
  const progress = $derived(step ? 1 - left / (step.seconds * 1000) : 0);
  const remaining = $derived(steps.slice(index + 1).reduce((sum, s) => sum + s.seconds, 0) + seconds);
  const done = $derived(steps.length ? 1 - remaining / totalSeconds(steps) : 0);

  function begin(at: number) {
    index = at;
    endsAt = Date.now() + steps[at].seconds * 1000;
    left = steps[at].seconds * 1000;
    lastSecond = steps[at].seconds;
  }

  function finish(early: boolean) {
    stopped = early;
    phase = 'done';
  }

  function next() {
    const from = steps[index];
    if (index + 1 >= steps.length) {
      cue('rest');
      finish(false);
      return;
    }
    begin(index + 1);
    const to = steps[index];
    if (to.kind === 'effort' || (to.kind === 'warmup' && from.kind === 'warmup')) cue('go');
    else if (from.kind === 'effort') cue('rest');
  }

  function tick() {
    if (phase !== 'running' || paused || !steps.length) return;
    left = Math.max(0, endsAt - Date.now());
    const s = Math.ceil(left / 1000);
    if (s !== lastSecond) {
      lastSecond = s;
      if (s > 0 && s <= 3) cue('tick');
    }
    if (left <= 0) next();
  }

  function togglePause() {
    if (paused) endsAt = Date.now() + left;
    paused = !paused;
  }

  async function save(rpe: number) {
    if (!plan || saving) return;
    saving = true;
    error = null;
    try {
      await api.finishTabletWorkout({ session: plan.session, rpe, stopped });
      phase = 'saved';
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  const leave = () => navigate(routePath({ name: 'sport', back }));

  let wakeLock: { release(): Promise<void> } | null = null;

  onMount(() => {
    api
      .tabletWorkout()
      .then((p) => {
        plan = p;
        steps = workoutSteps(p);
        begin(0);
        cue('go');
      })
      .catch((err: Error) => (error = err.message));
    const timer = setInterval(tick, TICK_MS);
    const keepalive = setInterval(() => void api.tabletWorkout().catch(() => {}), KEEPALIVE_MS);
    // L'écran reste allumé pendant la séance, si le navigateur le permet.
    void (navigator as { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((lock) => (wakeLock = lock))
      .catch(() => {});
    return () => {
      clearInterval(timer);
      clearInterval(keepalive);
    };
  });

  onDestroy(() => {
    void wakeLock?.release().catch(() => {});
    actor.stay(); // délais repartis de zéro : la personne compte comme vue à l'instant
  });

  function label(s: WorkoutStep): string {
    if (s.kind === 'warmup') return `Échauffement · ${s.index}/${WARMUP.length}`;
    if (s.kind === 'effort') return `Tour ${s.round}/${plan?.rounds} · exercice ${s.index}/${plan?.exercises.length}`;
    if (s.kind === 'break') return `Pause avant le tour ${s.round}/${plan?.rounds}`;
    return 'Repos';
  }
</script>

<div class="workout">
  {#if phase === 'running' && step && plan}
    <header>
      <span class="label">{label(step)}</span>
      <span class="muted">encore {formatMinutes(remaining)}</span>
    </header>
    <div class="bar" aria-hidden="true"><span style:width="{done * 100}%"></span></div>

    <main class:resting={step.kind === 'rest' || step.kind === 'break'}>
      <div class="info">
        {#if step.kind === 'rest' || step.kind === 'break'}
          <p class="kicker">Ensuite</p>
        {:else}
          <p class="kicker">{step.kind === 'warmup' ? 'Doucement' : FAMILY_LABELS[step.exercise.family]}</p>
        {/if}
        <h1>{step.exercise.name}</h1>
        {#if step.cue}
          <p class="cue">{step.cue}</p>
        {:else if step.kind === 'effort'}
          <p class="cue">{step.exercise.unit === 's' ? 'Tiens la position.' : 'À ton rythme, mouvement propre.'}{step.exercise.sides ? ' Change de côté à chaque tour.' : ''}</p>
        {:else}
          <p class="cue">Respire, bois un peu, mets-toi en place.</p>
        {/if}
        <div class="count" class:last={seconds <= 3} role="timer" aria-live="off">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="54" class="track" />
            <circle cx="60" cy="60" r="54" class="ring" stroke-dasharray="{339.3 * (1 - progress)} 339.3" transform="rotate(-90 60 60)" />
          </svg>
          <span>{seconds}</span>
        </div>
      </div>
      <div class="animation">
        {#key `${index}-${step.exercise.id}`}
          <ExerciseAnimation
            id={step.exercise.id}
            still={step.kind === 'rest' || step.kind === 'break'}
            {paused}
            controls={false}
            height={420}
            label={`Animation : ${step.exercise.name}`}
          />
        {/key}
      </div>
    </main>

    <footer>
      <button type="button" onclick={togglePause}>{paused ? 'Reprendre' : 'Pause'}</button>
      <button type="button" onclick={next}>Passer</button>
      <button type="button" class="stop" onclick={() => finish(true)}>Arrêter</button>
    </footer>
  {:else if phase === 'done'}
    <div class="end">
      <h1>{stopped ? 'Séance arrêtée' : 'Séance terminée, bravo !'}</h1>
      <p class="muted">Comment c’était ?</p>
      <div class="rpe">
        {#each [1, 2, 3, 4, 5] as rpe (rpe)}
          <button type="button" disabled={saving} onclick={() => save(rpe)}>{RPE_LABELS[rpe]}</button>
        {/each}
      </div>
      {#if error}<p class="error">{error}</p>{/if}
      <button type="button" class="quiet" onclick={leave}>Ne pas noter</button>
    </div>
  {:else if phase === 'saved'}
    <div class="end">
      <h1>C’est noté !</h1>
      <p class="muted">Le détail par exercice (difficulté, gênes) se note sur ton téléphone.</p>
      <button type="button" class="primary" onclick={leave}>Terminer</button>
    </div>
  {:else}
    <div class="end">
      <h1>Séance guidée</h1>
      <p class="muted">{error ?? 'Chargement…'}</p>
      <button type="button" class="primary" onclick={leave}>Retour</button>
    </div>
  {/if}
</div>

<style>
  .workout {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 28px 48px;
    box-sizing: border-box;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .label {
    font-size: 1.6rem;
    font-weight: 600;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
    font-size: 1.3rem;
  }

  .bar {
    height: 8px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--rain);
  }

  main {
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: center;
    gap: 32px;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .kicker {
    margin: 0;
    color: var(--fg-muted);
    font-size: 1.2rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 3rem;
    font-weight: 700;
    line-height: 1.1;
  }

  .cue {
    margin: 0;
    font-size: 1.4rem;
    line-height: 1.4;
  }

  .count {
    position: relative;
    width: 260px;
    height: 260px;
    margin-top: 12px;
  }

  .count svg {
    width: 100%;
    height: 100%;
  }

  .count span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 6.5rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .track {
    fill: none;
    stroke: var(--surface-2);
    stroke-width: 9;
  }

  .ring {
    fill: none;
    stroke: var(--rain);
    stroke-width: 9;
  }

  .resting .ring {
    stroke: var(--fg-muted);
  }

  .count.last span {
    color: var(--sun);
  }

  .animation {
    display: grid;
    place-items: center;
  }

  footer {
    display: flex;
    justify-content: center;
    gap: 16px;
  }

  button {
    min-height: 60px;
    padding: 0 32px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .stop {
    color: var(--fg-muted);
  }

  .end {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    text-align: center;
  }

  .rpe {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
  }

  .rpe button,
  .primary {
    border-color: var(--rain);
  }

  .primary {
    background: var(--rain);
    color: var(--bg);
  }

  .quiet {
    border: 0;
    color: var(--fg-muted);
  }

  .error {
    margin: 0;
    color: var(--sun);
  }
</style>
