<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { FAMILY_LABELS } from '../../../shared/fitness-catalogue.ts';
  import { type WorkoutStep, workoutSteps } from '../../../shared/fitness-workout.ts';
  import { SCREEN_PROTOCOL, SCREEN_PROTOCOL_HEADER } from '../../../shared/screen.ts';
  import type { ScreenWorkoutLive, ScreenWorkoutPlan, ScreenWorkoutState } from '../../../shared/screen-workout.ts';
  import ExerciseAnimation from '../components/fitness/ExerciseAnimation.svelte';
  import { cue, unlockAudio } from '../lib/beep.ts';
  import { formatMinutes } from '../lib/fitness.ts';
  import { stepCue, stepLabel, timerFrom } from '../lib/tele-sport.ts';
  import { tickWorkout, type WorkoutTimer, workoutView } from '../lib/workout-timer.ts';

  // Séance de sport sur la télé (fonction 12), dans la WebView de l'appli HomeHub TV. Elle ne montre que la séance en
  // cours : l'étape, l'exercice et son animation, le compte à rebours, le tour. Ni prénom, ni historique, ni mesures :
  // le serveur ne les envoie pas. Le téléphone pilote (pause, suivant, arrêter) ; la page suit par interrogation longue
  // et fait défiler le compte à rebours elle-même entre deux nouvelles, bips compris. Quand la séance n'existe plus
  // (finie, arrêtée), la page s'efface et demande à l'appli de se fermer (l'appli le fait aussi d'elle-même).
  type Props = { token: string | null };
  let { token }: Props = $props();

  const TICK_MS = 200;
  const RETRY_MS = 2_000;
  /** La page vide reste ce temps-là avant de demander à l'appli de se fermer. */
  const CLOSE_MS = 4_000;
  /** Animation à un peu plus de la moitié de la hauteur d'écran (WebView Full HD : 540 px CSS de haut). */
  let animationHeight = $state(Math.round(window.innerHeight * 0.55));

  let plan = $state.raw<ScreenWorkoutPlan | null>(null);
  let steps = $state.raw<WorkoutStep[]>([]);
  let timer = $state.raw<WorkoutTimer | null>(null);
  let gone = $state(false);
  let error = $state<string | null>(null);
  let planKey = '';
  let rev: number | null = null;
  let alive = true;
  let closing: ReturnType<typeof setTimeout> | null = null;

  const view = $derived(timer && steps.length ? workoutView(timer, steps) : null);
  const step = $derived(view?.step);

  /** Fermeture par l'appli (pont JavaScript de SportActivity), si elle l'offre. */
  function close() {
    (window as unknown as { HomeHubTV?: { close(): void } }).HomeHubTV?.close();
  }

  function apply(workout: ScreenWorkoutLive | null) {
    if (!workout) {
      plan = null;
      timer = null;
      gone = true;
      closing ??= setTimeout(close, CLOSE_MS);
      return;
    }
    if (closing) clearTimeout(closing);
    closing = null;
    gone = false;
    const key = JSON.stringify(workout.plan);
    if (key !== planKey) {
      planKey = key;
      plan = workout.plan;
      steps = workoutSteps(workout.plan);
    }
    timer = timerFrom(workout, Date.now());
  }

  async function follow() {
    const headers = { Authorization: `Bearer ${token}`, [SCREEN_PROTOCOL_HEADER]: String(SCREEN_PROTOCOL) };
    while (alive) {
      try {
        const res = await fetch(`/api/screen/workout${rev === null ? '' : `?after=${rev}`}`, { headers, cache: 'no-store' });
        const body = (await res.json().catch(() => null)) as (ScreenWorkoutState & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
        error = null;
        rev = body.rev;
        apply(body.workout);
      } catch (err) {
        error = (err as Error).message;
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }
  }

  onMount(() => {
    unlockAudio(); // l'appli permet le son sans geste (setMediaPlaybackRequiresUserGesture(false))
    if (token) void follow();
    else error = 'Jeton de la télé absent';
    const resize = () => (animationHeight = Math.round(window.innerHeight * 0.55));
    window.addEventListener('resize', resize);
    const ticker = setInterval(() => {
      if (!timer || !steps.length) return;
      const { timer: next, cues } = tickWorkout(timer, steps, Date.now());
      timer = next;
      for (const c of cues) cue(c);
    }, TICK_MS);
    return () => {
      clearInterval(ticker);
      window.removeEventListener('resize', resize);
    };
  });

  onDestroy(() => {
    alive = false;
    if (closing) clearTimeout(closing);
  });
</script>

<div class="tele">
  {#if plan && timer && timer.phase === 'running' && step && view}
    <header>
      <span class="label">{stepLabel(step, plan)}</span>
      <span class="muted">encore {formatMinutes(view.remaining)}</span>
    </header>
    <div class="bar" aria-hidden="true"><span style:width="{view.done * 100}%"></span></div>

    <main class:resting={step.kind === 'rest' || step.kind === 'break'}>
      <div class="info">
        <p class="kicker">
          {step.kind === 'rest' || step.kind === 'break' ? 'Ensuite' : step.kind === 'warmup' ? 'Doucement' : FAMILY_LABELS[step.exercise.family]}
        </p>
        <h1>{step.exercise.name}</h1>
        <p class="cue">{stepCue(step)}</p>
        {#if view.side}
          <p class="side" class:switching={view.switching}>{view.switching ? 'Change de côté !' : `Côté ${view.side} sur 2`}</p>
        {/if}
        <div class="count" class:last={view.seconds <= 3}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="54" class="track" />
            <circle cx="60" cy="60" r="54" class="ring" stroke-dasharray="{339.3 * (1 - view.progress)} 339.3" transform="rotate(-90 60 60)" />
          </svg>
          <span>{view.seconds}</span>
        </div>
      </div>
      <div class="animation">
        {#key `${timer.index}-${step.exercise.id}`}
          <ExerciseAnimation id={step.exercise.id} still={step.kind === 'rest' || step.kind === 'break'} paused={timer.paused} controls={false} height={animationHeight} />
        {/key}
      </div>
      {#if timer.paused}<p class="paused">En pause</p>{/if}
    </main>

    <footer class="muted">Pause, suivant, arrêter : depuis le téléphone</footer>
  {:else if plan && timer}
    <div class="end"><h1>Séance terminée, bravo !</h1></div>
  {:else}
    <div class="end">
      <h1>{gone ? 'C’est fini' : 'Séance de sport'}</h1>
      <p class="muted">{error ?? (gone ? 'L’écran s’efface.' : 'Chargement…')}</p>
    </div>
  {/if}
</div>

<style>
  /* Télé vue de loin : tailles en hauteur d'écran ; mise en page simple pour une WebView ancienne (grille, flex). */
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    overflow: hidden;
  }

  :global(#app) {
    height: 100%;
  }

  .tele {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 2vh;
    padding: 4vh 5vw;
    box-sizing: border-box;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .label {
    font-size: 4vh;
    font-weight: 600;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
    font-size: 3vh;
  }

  .bar {
    height: 1vh;
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
    position: relative;
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 4vw;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 1.5vh;
  }

  .kicker {
    margin: 0;
    color: var(--fg-muted);
    font-size: 2.8vh;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 7vh;
    font-weight: 700;
    line-height: 1.1;
  }

  .cue {
    margin: 0;
    font-size: 3.4vh;
    line-height: 1.4;
  }

  .side {
    align-self: flex-start;
    margin: 0;
    padding: 0.8vh 2vh;
    border: 2px solid var(--border-strong);
    border-radius: 999px;
    color: var(--fg-muted);
    font-size: 3vh;
    font-weight: 600;
  }

  .side.switching {
    border-color: var(--sun);
    background: var(--sun);
    color: var(--bg);
    font-size: 4.5vh;
  }

  .count {
    position: relative;
    width: 32vh;
    height: 32vh;
    margin-top: 1vh;
  }

  .count svg {
    width: 100%;
    height: 100%;
  }

  .count span {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14vh;
    font-weight: 700;
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
    display: flex;
    justify-content: center;
  }

  .paused {
    position: absolute;
    top: 50%;
    left: 50%;
    margin: 0;
    padding: 2vh 5vh;
    border-radius: 999px;
    background: var(--sun);
    color: var(--bg);
    font-size: 6vh;
    font-weight: 700;
    transform: translate(-50%, -50%);
  }

  footer {
    text-align: center;
    font-size: 2.4vh;
  }

  .end {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2vh;
    text-align: center;
  }
</style>
