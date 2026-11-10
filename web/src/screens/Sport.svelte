<script lang="ts">
  import { exerciseById, FAMILIES, FAMILY_LABELS, type FitnessFamily } from '../../../shared/fitness-catalogue.ts';
  import { PALIERS } from '../../../shared/fitness.ts';
  import { type TabletSession, totalSeconds, workoutSteps } from '../../../shared/fitness-workout.ts';
  import BackButton from '../components/BackButton.svelte';
  import ExerciseAnimation from '../components/fitness/ExerciseAnimation.svelte';
  import ExerciseDetail from '../components/fitness/ExerciseDetail.svelte';
  import Modal from '../components/stock/Modal.svelte';
  import { ApiError } from '../lib/api.ts';
  import { unlockAudio } from '../lib/beep.ts';
  import { getAppContext } from '../lib/context.ts';
  import { familyExercises, formatMinutes } from '../lib/fitness.ts';
  import { type PageRoute, routePath } from '../lib/route.ts';

  // Sport sur la tablette : la séance du jour de la personne reconnue devant elle (elle seule, rien de personnel :
  // ni notes, ni historique, ni tour de taille), d'où part la séance guidée, et le catalogue des exercices.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, actor, config, navigate } = getAppContext();

  let today = $state<TabletSession | null>(null);
  let error = $state<string | null>(null);
  const name = $derived(today ? (config.members.find((m) => m.id === today?.ownerId)?.name ?? '') : '');

  // Séance du jour relue à chaque changement de personne reconnue ; le serveur dit pour qui (personne : la bulle
  // « Regarde la tablette »).
  $effect(() => {
    void actor.current?.id;
    let live = true;
    api
      .tabletWorkout()
      .then((plan) => {
        if (!live) return;
        today = plan;
        error = null;
      })
      .catch((err: unknown) => {
        if (!live) return;
        today = null;
        error = err instanceof ApiError && err.identify ? null : (err as Error).message;
      });
    return () => {
      live = false;
    };
  });

  // On s'éloigne souvent de la tablette avant de commencer (tapis, tenue) : tant que la page est ouverte, la
  // personne reconnue reste retenue sans son visage (actor.keep) et sa session sur le serveur est prolongée. Une
  // autre personne reconnue la remplace ; le retour à l'accueil sans contact (ui.idleTimeoutSeconds) la libère.
  const KEEP_MS = 2_000;
  const KEEPALIVE_MS = 30_000;
  $effect(() => {
    if (!actor.current) return;
    const keep = setInterval(() => actor.keep(), KEEP_MS);
    const keepAlive = setInterval(() => void api.tabletWorkout().catch((err: unknown) => actor.check(err)), KEEPALIVE_MS);
    return () => {
      clearInterval(keep);
      clearInterval(keepAlive);
    };
  });

  const steps = $derived(today ? workoutSteps(today) : []);

  let family = $state<FitnessFamily>('cardio');
  let opened = $state<string | null>(null);
  const openedExercise = $derived(opened ? exerciseById(opened) : undefined);

  function start() {
    unlockAudio(); // le son n'est permis qu'après un geste : celui-ci
    navigate(routePath({ name: 'workout', back }));
  }
</script>

<div class="page">
  <header>
    <BackButton {back} />
    <h1>Sport</h1>
  </header>

  <div class="columns">
    <section class="today" aria-labelledby="today-title">
      <h2 id="today-title">Séance du jour</h2>
      {#if today}
        <p class="who">
          {name} · séance {today.session} · palier {today.palier} ({PALIERS[today.palier].name})
        </p>
        <p class="muted">
          {today.rounds} tours, {today.effort} s d’effort et {today.rest} s de repos ; environ {formatMinutes(totalSeconds(steps))}
          avec l’échauffement.
        </p>
        <ul class="plan">
          {#each today.exercises as item (item.family)}
            {@const exercise = exerciseById(item.id)}
            {#if exercise}
              <li>
                <button type="button" class="tile" onclick={() => (opened = exercise.id)}>
                  <span class="thumb"><ExerciseAnimation id={exercise.id} still height={48} /></span>
                  <span class="text">
                    <span class="family">{FAMILY_LABELS[item.family]}</span>
                    {exercise.name}
                  </span>
                </button>
              </li>
            {/if}
          {/each}
        </ul>
        <button type="button" class="start" onclick={start}>Commencer la séance</button>
        <p class="muted small">La tablette reste sur ton profil pendant toute la séance, même loin de la caméra.</p>
      {:else if error}
        <p class="hint">{error === 'Pas de programme sur ce profil' && actor.current ? `Pas de programme de sport sur le profil de ${actor.current.name}.` : error}</p>
      {:else}
        <p class="hint">Regarde la tablette : ta séance du jour s’affiche dès que tu es reconnu.</p>
      {/if}
    </section>

    <section class="catalogue" aria-labelledby="catalogue-title">
      <h2 id="catalogue-title">Catalogue des exercices</h2>
      <div class="families" role="tablist">
        {#each FAMILIES as f (f)}
          <button type="button" role="tab" aria-selected={family === f} class:on={family === f} onclick={() => (family = f)}>{FAMILY_LABELS[f]}</button>
        {/each}
      </div>
      <ul class="grid">
        {#each familyExercises(family) as e (e.id)}
          <li>
            <button type="button" class="tile" onclick={() => (opened = e.id)}>
              <span class="thumb"><ExerciseAnimation id={e.id} still height={48} /></span>
              <span class="text">{e.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  </div>
</div>

{#if openedExercise}
  <Modal label={openedExercise.name} wide onClose={() => (opened = null)}>
    <ExerciseDetail exercise={openedExercise} onOpen={(id) => (opened = id)} />
    <button type="button" class="close" onclick={() => (opened = null)}>Fermer</button>
  </Modal>
{/if}

<style>
  .page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 36px 48px;
    box-sizing: border-box;
  }

  header {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  h1 {
    margin: 0;
    font-size: 2.5rem;
    font-weight: 600;
  }

  h2 {
    margin: 0 0 12px;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .columns {
    flex-grow: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
    gap: 24px;
  }

  section {
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 24px;
    border-radius: var(--radius-lg, 24px);
    background: var(--surface);
    overflow-y: auto;
  }

  .who {
    margin: 0 0 4px;
    font-size: 1.3rem;
    font-weight: 600;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
    font-size: 1.1rem;
    line-height: 1.4;
  }

  .small {
    margin-top: 10px;
    font-size: 0.95rem;
  }

  .hint {
    margin: auto 0;
    color: var(--fg-muted);
    font-size: 1.4rem;
    line-height: 1.4;
    text-align: center;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* La liste défile au besoin : le bouton Commencer reste toujours visible. */
  .today {
    overflow: hidden;
  }

  .plan {
    flex: 0 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: start;
    gap: 8px;
    margin: 16px 0;
    overflow-y: auto;
  }

  .plan .tile {
    height: 100%;
    font-size: 1rem;
  }

  .plan .thumb {
    width: 60px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .tile {
    width: 100%;
    min-height: 60px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 14px 6px 6px;
    border: 0;
    border-radius: 16px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1.1rem;
    text-align: left;
  }

  .thumb {
    flex: none;
    width: 72px;
    display: grid;
    place-items: center;
  }

  .text {
    display: flex;
    flex-direction: column;
  }

  .family {
    color: var(--fg-muted);
    font-size: 0.85rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .start {
    flex: none;
    min-height: 64px;
    border: 0;
    border-radius: 999px;
    background: var(--rain);
    color: var(--bg);
    font: inherit;
    font-size: 1.35rem;
    font-weight: 700;
  }

  .families {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }

  .families button {
    min-height: 44px;
    padding: 0 18px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 1.05rem;
  }

  .families button.on {
    border-color: var(--rain);
    background: var(--rain);
    color: var(--bg);
    font-weight: 600;
  }

  .close {
    min-height: 52px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }
</style>
