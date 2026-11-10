<script lang="ts">
  import { onDestroy } from 'svelte';
  import { exerciseById, FAMILIES, FAMILY_LABELS } from '../../../../shared/fitness-catalogue.ts';
  import { type FitnessState, nextSession, pendingReview, planSession, type SessionNumber, type SessionReport, slotProposals, weekOf } from '../../../../shared/fitness.ts';
  import type { Api } from '../../lib/api.ts';
  import { familyExercises, waistSeries } from '../../lib/fitness.ts';
  import { createResource } from '../../lib/resource.svelte.ts';
  import Icon from '../Icon.svelte';
  import ExerciseDetail from './ExerciseDetail.svelte';
  import ExerciseList from './ExerciseList.svelte';
  import HistoryCard from './HistoryCard.svelte';
  import NextSessionCard from './NextSessionCard.svelte';
  import ProgramSettingsCard from './ProgramSettingsCard.svelte';
  import ProposalCard from './ProposalCard.svelte';
  import SessionForm from './SessionForm.svelte';
  import StatsView from './StatsView.svelte';
  import WeekLogCard from './WeekLogCard.svelte';
  import WeekReviewCard from './WeekReviewCard.svelte';

  // Onglet Sport du téléphone : la prochaine séance, le bilan de la semaine (rythme à choisir), les changements
  // d'exercice proposés, le cardio et le tour de taille de la semaine, l'historique, les réglages du programme
  // (élastique, sans sauts), les statistiques et le catalogue des exercices. Ce composant garde le programme et la vue affichée ; chaque carte est un composant de ce dossier.
  // Données personnelles : seul ce téléphone les voit.
  type Props = { api: Api; now: Date; onScrollTop: () => void };
  let { api, now, onScrollTop }: Props = $props();

  const REFRESH_MS = 5 * 60_000;
  const fitness = createResource(() => api.fitness(), REFRESH_MS);
  onDestroy(() => fitness.destroy());

  type View = { name: 'home' } | { name: 'log' } | { name: 'catalogue' } | { name: 'stats' } | { name: 'exercise'; id: string; back: View };
  let view = $state<View>({ name: 'home' });
  let chosen = $state<SessionNumber | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);

  function go(next: View) {
    view = next;
    onScrollTop();
  }

  /** Fiche d'un exercice, avec retour vers `back`. */
  const open = (back: View) => (id: string) => go({ name: 'exercise', id, back });

  const program = $derived(fitness.data);
  const session = $derived(chosen ?? (program ? nextSession(program) : 1));
  const plan = $derived(program ? planSession(program, session) : []);
  const review = $derived(program ? pendingReview(program, now) : null);
  const proposals = $derived(program ? slotProposals(program) : []);
  const thisWeek = $derived(weekOf(now));
  const weekSessions = $derived(program?.sessions.filter((s) => weekOf(new Date(s.at)) === thisWeek).length ?? 0);
  const waist = $derived(program ? waistSeries(program) : []);

  /** Envoie une modification ; la réponse est le programme à jour. */
  async function act(run: () => Promise<FitnessState>) {
    busy = true;
    error = null;
    try {
      fitness.set(await run());
      return true;
    } catch (err) {
      error = (err as Error).message;
      return false;
    } finally {
      busy = false;
    }
  }

  /** Séance notée ; un refus du serveur s'affiche dans le formulaire (SessionForm), qui reste ouvert. */
  async function submit(report: SessionReport) {
    const next = await api.addFitnessSession(report);
    fitness.set(next);
    chosen = null;
    go({ name: 'home' });
  }
</script>

<div class="sport">
  {#if view.name !== 'home'}
    <button type="button" class="back" onclick={() => go(view.name === 'exercise' ? view.back : { name: 'home' })}>
      <Icon name="back" size={22} /> Retour
    </button>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}

  {#if view.name === 'exercise'}
    {@const exercise = exerciseById(view.id)}
    {#if exercise}
      <ExerciseDetail {exercise} onOpen={open(view.name === 'exercise' ? view.back : { name: 'home' })} />
    {/if}
  {:else if view.name === 'stats'}
    {#if program}
      <StatsView {program} {now} onOpen={open({ name: 'stats' })} />
    {/if}
  {:else if view.name === 'catalogue'}
    <h2 class="section">Les exercices</h2>
    {#each FAMILIES as family (family)}
      <h3 class="family">{FAMILY_LABELS[family]}</h3>
      <ExerciseList items={familyExercises(family)} key={(e) => e.id} exercise={(e) => e} boxed onOpen={open({ name: 'catalogue' })}>
        {#snippet detail(e)}{e.primary.join(', ')}{/snippet}
      </ExerciseList>
    {/each}
  {:else if !program}
    {#if fitness.error}<p class="muted">Impossible de charger le programme : {fitness.error}</p>{:else}<p class="muted">Chargement…</p>{/if}
  {:else if view.name === 'log'}
    <SessionForm {session} {plan} onSubmit={submit} onCancel={() => go({ name: 'home' })} />
  {:else}
    {#if review}
      <WeekReviewCard {review} {busy} onChoose={(option) => act(() => api.chooseRhythm(review.week, option))} />
    {/if}

    <NextSessionCard {program} {session} {plan} onPick={(n) => (chosen = n)} onOpen={open({ name: 'home' })} onLog={() => go({ name: 'log' })} />

    {#each proposals as p (`${p.session}-${p.family}`)}
      <ProposalCard
        proposal={p}
        {busy}
        onAnswer={(accept) => act(() => api.changeExercise(p.session, p.family, accept ? p.change : 'dismiss'))}
        onOpen={open({ name: 'home' })}
      />
    {/each}

    {#key thisWeek}
      <WeekLogCard saved={program.weeks[thisWeek]} sessions={weekSessions} {waist} {busy} onSave={(log) => act(() => api.saveFitnessWeek(thisWeek, log))} />
    {/key}

    {#if program.sessions.length}
      <HistoryCard sessions={program.sessions} {busy} onRemove={(id) => act(() => api.removeFitnessSession(id))} />
    {/if}

    <ProgramSettingsCard settings={program.settings} {busy} onSave={(settings) => act(() => api.saveFitnessSettings(settings))} />

    <button type="button" class="link" onclick={() => go({ name: 'stats' })}>
      <Icon name="flag" size={22} /> Statistiques et tout l’historique
    </button>

    <button type="button" class="link" onclick={() => go({ name: 'catalogue' })}>
      <Icon name="list" size={22} /> Les exercices : comment les faire, muscles travaillés
    </button>

    <p class="disclaimer">
      HomeHub n’est pas un coach : arrête un exercice qui fait mal, et demande l’avis d’un médecin avant le palier 3 ou en cas de doute.
    </p>
  {/if}
</div>

<style>
  .sport {
    padding-bottom: 12px;
  }

  .back {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    margin-bottom: 8px;
    padding: 0 14px 0 8px;
    border: 0;
    border-radius: 999px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }

  .section {
    margin: 0 0 6px;
    font-size: 1.25rem;
  }

  .muted {
    color: var(--fg-muted);
  }

  .error {
    color: var(--danger-fg);
  }

  .family {
    margin: 16px 0 2px;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .link {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 54px;
    margin-bottom: 14px;
    padding: 0 16px;
    border: 0;
    border-radius: 18px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
    text-align: left;
  }

  .disclaimer {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.85rem;
  }
</style>
