<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { workoutSteps } from '../../../../shared/fitness-workout.ts';
  import { type PhoneScreenWorkout, positionAt, type ScreenWorkoutCommand } from '../../../../shared/screen-workout.ts';
  import type { Api } from '../../lib/api.ts';
  import { formatMinutes } from '../../lib/fitness.ts';
  import { stepLabel } from '../../lib/tele-sport.ts';
  import SportCard from './SportCard.svelte';

  // Pilotage de la séance qui défile sur la télé (onglet Sport du téléphone) : l'étape et le compte à rebours, et
  // Pause / Reprendre, Suivant, Arrêter. La séance se relit toutes les quelques secondes et le compte à rebours défile
  // entre deux ; finie ou arrêtée, la télé s'efface et `onDone` ouvre la note de la séance, ici seulement.
  type Props = { api: Api; initial: PhoneScreenWorkout; onDone: (workout: PhoneScreenWorkout) => void };
  let { api, initial, onDone }: Props = $props();

  const POLL_MS = 3_000;
  const TICK_MS = 250;

  let workout = $state.raw(untrack(() => initial));
  let receivedAt = $state(Date.now());
  let now = $state(Date.now());
  let busy = $state(false);
  let error = $state<string | null>(null);

  const steps = $derived(workoutSteps(workout.plan));
  const position = $derived(positionAt(workout, steps, receivedAt, now));
  const step = $derived(steps[position.index]);
  const seconds = $derived(Math.ceil(position.left / 1000));
  const remaining = $derived(steps.slice(position.index + 1).reduce((sum, s) => sum + s.seconds, 0) + seconds);

  function take(next: PhoneScreenWorkout | null) {
    if (!next) return onDone({ ...workout, phase: 'done', stopped: true });
    workout = next;
    receivedAt = Date.now();
    if (next.phase === 'done') onDone(next);
  }

  async function send(command: ScreenWorkoutCommand) {
    busy = true;
    error = null;
    try {
      take(await api.commandScreenWorkout(command));
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    const poll = setInterval(() => void api.screenWorkout().then(take, () => {}), POLL_MS);
    const tick = setInterval(() => {
      now = Date.now();
      // Fin prévue atteinte : la relire tout de suite plutôt qu'attendre le prochain tour.
      if (position.finished) void api.screenWorkout().then(take, () => {});
    }, TICK_MS);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  });
</script>

<SportCard>
  <p class="where">Séance {workout.session} sur {workout.screen.name}</p>
  {#if step}
    <p class="label">{stepLabel(step, workout.plan)}{position.paused ? ' · en pause' : ''}</p>
    <div class="now">
      <h2>{step.kind === 'rest' || step.kind === 'break' ? `Ensuite : ${step.exercise.name}` : step.exercise.name}</h2>
      <span class="count" class:last={seconds <= 3} role="timer">{seconds}</span>
    </div>
    <p class="muted">encore {formatMinutes(remaining)}</p>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
  <div class="actions">
    <button type="button" class="main" disabled={busy} onclick={() => send('pause')}>{position.paused ? 'Reprendre' : 'Pause'}</button>
    <button type="button" disabled={busy} onclick={() => send('next')}>Suivant</button>
    <button type="button" class="stop" disabled={busy} onclick={() => send('stop')}>Arrêter</button>
  </div>
  <p class="muted small">La télé ne montre que la séance en cours ; à la fin, elle s’efface et tu notes la séance ici.</p>
</SportCard>

<style>
  .where {
    margin: 0;
    color: var(--fg-muted);
    font-weight: 600;
  }

  .label {
    margin: 6px 0 0;
    font-size: 1.05rem;
  }

  .now {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    margin: 4px 0;
    font-size: 1.35rem;
  }

  .count {
    min-width: 2.5ch;
    font-size: 2.6rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .count.last {
    color: var(--sun);
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
  }

  .small {
    margin-top: 10px;
    font-size: 0.88rem;
  }

  .error {
    color: var(--danger-fg);
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
    margin-top: 14px;
  }

  button {
    min-height: 54px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 700;
  }

  .main {
    border-color: var(--rain);
    background: var(--rain);
    color: var(--bg);
  }

  .stop {
    color: var(--fg-muted);
  }
</style>
