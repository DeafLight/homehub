<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { FAMILY_LABELS } from '../../../shared/fitness-catalogue.ts';
  import { RPE_LABELS } from '../../../shared/fitness.ts';
  import { type TabletSession, WARMUP, type WorkoutStep, workoutSteps } from '../../../shared/fitness-workout.ts';
  import ExerciseAnimation from '../components/fitness/ExerciseAnimation.svelte';
  import { cue } from '../lib/beep.ts';
  import { getAppContext } from '../lib/context.ts';
  import { formatMinutes } from '../lib/fitness.ts';
  import { type PageRoute, routePath } from '../lib/route.ts';
  import { createWakeLock } from '../lib/wake-lock.ts';
  import { markSaved, skipStep, startWorkout, stopWorkout, tickWorkout, togglePause, type Transition, type WorkoutTimer, workoutView } from '../lib/workout-timer.ts';

  // Séance guidée sur la tablette : échauffement, puis chaque effort avec son compte à rebours, et pendant le repos
  // l'exercice suivant. Bips sur les trois dernières secondes, au départ et à la fin de chaque effort ; pour un exercice
  // d'un côté puis de l'autre, bip distinct et « Change de côté » en grand à la moitié de l'effort. Rien de
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

  /** État du minuteur (voir lib/workout-timer.ts) ; « done » en attendant les étapes, d'où `phase` ci-dessous. */
  let timer = $state.raw<WorkoutTimer>(startWorkout([], 0).timer);
  let saving = $state(false);

  const view = $derived(workoutView(timer, steps));
  const step = $derived(view.step);
  const seconds = $derived(view.seconds);
  const side = $derived(view.side);
  const switching = $derived(view.switching);
  const progress = $derived(view.progress);
  const remaining = $derived(view.remaining);
  const done = $derived(view.done);
  const index = $derived(timer.index);
  const paused = $derived(timer.paused);
  const phase = $derived(steps.length ? timer.phase : 'loading');
  const stopped = $derived(timer.stopped);

  // L'écran reste allumé pendant que la séance défile, si le navigateur le permet ; rendu à la fin, à l'arrêt et
  // en sortant de la page.
  const wakeLock = createWakeLock();
  $effect(() => {
    if (phase === 'running') wakeLock.acquire();
    else wakeLock.release();
  });

  function apply({ timer: next, cues }: Transition) {
    timer = next;
    for (const c of cues) cue(c);
  }

  const tick = () => apply(tickWorkout(timer, steps, Date.now()));
  const skip = () => apply(skipStep(timer, steps, Date.now()));
  const pause = () => (timer = togglePause(timer, Date.now()));
  const stop = () => (timer = stopWorkout(timer));

  async function save(rpe: number) {
    if (!plan || saving) return;
    saving = true;
    error = null;
    try {
      await api.finishTabletWorkout({ session: plan.session, rpe, stopped });
      timer = markSaved(timer);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  const leave = () => navigate(routePath({ name: 'sport', back }));

  onMount(() => {
    api
      .tabletWorkout()
      .then((p) => {
        plan = p;
        steps = workoutSteps(p);
        apply(startWorkout(steps, Date.now()));
      })
      .catch((err: Error) => (error = err.message));
    const ticker = setInterval(tick, TICK_MS);
    const keepalive = setInterval(() => void api.tabletWorkout().catch(() => {}), KEEPALIVE_MS);
    return () => {
      clearInterval(ticker);
      clearInterval(keepalive);
    };
  });

  onDestroy(() => {
    wakeLock.release();
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
          <p class="cue">{step.exercise.unit === 's' ? 'Tiens la position.' : 'À ton rythme, mouvement propre.'}{side === 1 ? ' Change de côté à mi-temps, au signal.' : ''}</p>
          {#if side}
            <p class="side" class:switching role="status">{switching ? 'Change de côté !' : `Côté ${side} sur 2`}</p>
          {/if}
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
      <button type="button" onclick={pause}>{paused ? 'Reprendre' : 'Pause'}</button>
      <button type="button" onclick={skip}>Passer</button>
      <button type="button" class="stop" onclick={stop}>Arrêter</button>
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

  .side {
    align-self: flex-start;
    margin: 0;
    padding: 6px 18px;
    border: 2px solid var(--border-strong);
    border-radius: 999px;
    color: var(--fg-muted);
    font-size: 1.3rem;
    font-weight: 600;
  }

  .side.switching {
    border-color: var(--sun);
    background: var(--sun);
    color: var(--bg);
    font-size: 2rem;
    font-weight: 700;
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
