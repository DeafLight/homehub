<script lang="ts">
  import { onDestroy } from 'svelte';
  import { exerciseById, FAMILIES, FAMILY_LABELS } from '../../../../shared/fitness-catalogue.ts';
  import {
    type FitnessState,
    nextSession,
    OPTION_LABELS,
    PALIERS,
    palierHint,
    pendingReview,
    planSession,
    RPE_LABELS,
    type SessionNumber,
    sessionSeconds,
    type SlotProposal,
    slotProposals,
    WARMUP_MINUTES,
    weekOf,
  } from '../../../../shared/fitness.ts';
  import type { Api, SessionReport } from '../../lib/api.ts';
  import { familyExercises, formatMinutes, waistSeries } from '../../lib/fitness.ts';
  import { createResource } from '../../lib/resource.svelte.ts';
  import Icon from '../Icon.svelte';
  import ExerciseAnimation from './ExerciseAnimation.svelte';
  import ExerciseDetail from './ExerciseDetail.svelte';
  import SessionForm from './SessionForm.svelte';
  import StatsView from './StatsView.svelte';

  // Onglet Sport du téléphone : la prochaine séance, le bilan de la semaine (rythme à choisir), les changements
  // d'exercice proposés, le cardio et le tour de taille de la semaine, l'historique, les statistiques et le catalogue des
  // exercices.
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

  async function submit(report: SessionReport) {
    const next = await api.addFitnessSession(report);
    fitness.set(next);
    chosen = null;
    go({ name: 'home' });
  }

  const choose = (option: Parameters<Api['chooseRhythm']>[1]) => review && act(() => api.chooseRhythm(review.week, option));
  const answer = (p: SlotProposal, accept: boolean) => act(() => api.changeExercise(p.session, p.family, accept ? p.change : 'dismiss'));

  // Cardio et tour de taille de la semaine : champs locaux, enregistrés au bouton.
  let cardio = $state<number | null>(null);
  let waistInput = $state<number | null>(null);
  let loadedWeek = $state<string | null>(null);
  $effect(() => {
    if (!program || loadedWeek === thisWeek) return;
    const log = program.weeks[thisWeek];
    cardio = log?.cardio ?? null;
    waistInput = log?.waist ?? null;
    loadedWeek = thisWeek;
  });
  const weekDirty = $derived(
    program !== null && ((program.weeks[thisWeek]?.cardio ?? null) !== (cardio ?? null) || (program.weeks[thisWeek]?.waist ?? null) !== (waistInput ?? null)),
  );
  const saveWeek = () =>
    act(() => api.saveFitnessWeek(thisWeek, { cardio: typeof cardio === 'number' ? Math.round(cardio) : null, waist: typeof waistInput === 'number' ? waistInput : null }));

  let confirmDelete = $state<string | null>(null);
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

  /** Points du tour de taille, pour la courbe. */
  function waistPath(points: { waist: number }[]) {
    const W = 300;
    const H = 80;
    const min = Math.min(...points.map((p) => p.waist));
    const max = Math.max(...points.map((p) => p.waist));
    const span = max - min || 1;
    return points
      .map((p, i) => `${(i / (points.length - 1)) * (W - 12) + 6},${H - 8 - ((p.waist - min) / span) * (H - 16)}`)
      .join(' ');
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
      <ExerciseDetail {exercise} onOpen={(id) => go({ name: 'exercise', id, back: view.name === 'exercise' ? view.back : { name: 'home' } })} />
    {/if}
  {:else if view.name === 'stats'}
    {#if program}
      <StatsView {program} {now} onOpen={(id) => go({ name: 'exercise', id, back: { name: 'stats' } })} />
    {/if}
  {:else if view.name === 'catalogue'}
    <h2 class="section">Les exercices</h2>
    {#each FAMILIES as family (family)}
      <h3 class="family">{FAMILY_LABELS[family]}</h3>
      <ul class="list">
        {#each familyExercises(family) as e (e.id)}
          <li>
            <button type="button" class="thumbed" onclick={() => go({ name: 'exercise', id: e.id, back: { name: 'catalogue' } })}>
              <span class="thumb"><ExerciseAnimation id={e.id} still height={40} /></span>
              <span class="text">
                <span>{e.name}</span>
                <span class="muted small">{e.primary.join(', ')}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  {:else if !program}
    {#if fitness.error}<p class="muted">Impossible de charger le programme : {fitness.error}</p>{:else}<p class="muted">Chargement…</p>{/if}
  {:else if view.name === 'log'}
    <SessionForm {session} {plan} onSubmit={submit} onCancel={() => go({ name: 'home' })} />
  {:else}
    {#if review}
      <section class="card review">
        <h2>Bilan de la semaine</h2>
        <p>
          {#if review.verdict === 'up'}
            {review.sessions} séances, aucune dure : tu peux augmenter.
          {:else}
            Semaine difficile : tu peux alléger le rythme.
          {/if}
        </p>
        <div class="choices">
          {#each review.choices as c, i (c.option)}
            <button type="button" class:primary={i === 0} disabled={busy} onclick={() => choose(c.option)}>
              <span>{c.option === 'next-palier' ? `Palier ${c.rhythm.palier} (${PALIERS[c.rhythm.palier].name})` : OPTION_LABELS[c.option]}</span>
              <span class="small">{c.rhythm.effort} s / {c.rhythm.rest} s · {PALIERS[c.rhythm.palier].rounds} tours · {formatMinutes(c.seconds)}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <section class="card">
      <div class="next-head">
        <h2>Séance {session}</h2>
        <div class="pick" role="group" aria-label="Choisir une autre séance">
          {#each [1, 2, 3] as const as n (n)}
            <button type="button" class:on={n === session} aria-pressed={n === session} onclick={() => (chosen = n)}>{n}</button>
          {/each}
        </div>
      </div>
      <p class="rhythm">
        Palier {program.palier} · {PALIERS[program.palier].name} · {PALIERS[program.palier].rounds} tours ·
        <strong>{program.effort} s</strong> d’effort / <strong>{program.rest} s</strong> de repos
      </p>
      <p class="muted small">
        {formatMinutes(sessionSeconds(program))}, plus {WARMUP_MINUTES} min d’échauffement ; 1 min de pause entre les tours.
      </p>
      <ul class="list plan">
        {#each plan as item (item.family)}
          <li>
            <button type="button" class="thumbed" onclick={() => go({ name: 'exercise', id: item.exercise.id, back: { name: 'home' } })}>
              <span class="thumb"><ExerciseAnimation id={item.exercise.id} still height={40} /></span>
              <span class="text">
                <span>{item.exercise.name}</span>
                <span class="muted small">
                  {FAMILY_LABELS[item.family]}{item.exercise.unit === 's' ? ' · tenir' : ''}{item.exercise.sides ? ' · change de côté à chaque tour' : ''}
                  {#if item.normal}· à la place de {item.normal.name}{/if}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <button type="button" class="big" onclick={() => go({ name: 'log' })}>Noter la séance</button>
      <p class="hint">{palierHint(program)}</p>
    </section>

    {#each proposals as p (`${p.session}-${p.family}`)}
      <section class="card proposal">
        <p>
          <strong>{p.from.name}</strong> (séance {p.session}) : {p.reason}.
          {p.change === 'normal' ? 'Reprendre' : 'Passer à'} <strong>{p.to.name}</strong> ?
        </p>
        <div class="row">
          <button type="button" class="primary" disabled={busy} onclick={() => answer(p, true)}>Oui</button>
          <button type="button" disabled={busy} onclick={() => go({ name: 'exercise', id: p.to.id, back: { name: 'home' } })}>Voir</button>
          <button type="button" disabled={busy} onclick={() => answer(p, false)}>Non merci</button>
        </div>
      </section>
    {/each}

    <section class="card">
      <h2>Cette semaine</h2>
      <p class="muted">{weekSessions} séance{weekSessions > 1 ? 's' : ''} sur 3</p>
      <div class="week">
        <label>Cardio <input type="number" inputmode="numeric" min="0" max="5000" bind:value={cardio} placeholder="—" /> min</label>
        <label>Tour de taille <input type="number" inputmode="decimal" min="30" max="250" step="0.5" bind:value={waistInput} placeholder="—" /> cm</label>
      </div>
      {#if weekDirty}<button type="button" class="big" disabled={busy} onclick={saveWeek}>Enregistrer</button>{/if}
      {#if waist.length >= 2}
        <svg class="chart" viewBox="0 0 300 80" role="img" aria-label="Tour de taille au fil des semaines">
          <polyline points={waistPath(waist)} fill="none" stroke="var(--rain)" stroke-width="2.5" stroke-linejoin="round" />
        </svg>
        <p class="muted small">
          Tour de taille : {waist[0].waist} cm → {waist.at(-1)?.waist} cm ({waist.length} semaines)
        </p>
      {/if}
    </section>

    {#if program.sessions.length}
      <section class="card">
        <h2>Historique</h2>
        <ul class="history">
          {#each program.sessions.slice(-10).reverse() as s (s.id)}
            <li>
              <span class="when">{formatDate(s.at)}</span>
              <span class="what">
                Séance {s.session} · {s.effort}/{s.rest} · {RPE_LABELS[s.rpe].toLowerCase()}{s.stopped ? ' · arrêtée' : ''}
              </span>
              {#if confirmDelete === s.id}
                <button type="button" class="danger" disabled={busy} onclick={() => act(() => api.removeFitnessSession(s.id))}>Supprimer</button>
              {:else}
                <button type="button" class="icon" aria-label="Supprimer cette séance" onclick={() => (confirmDelete = s.id)}><Icon name="trash" size={18} /></button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

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

  .card {
    margin-bottom: 14px;
    padding: 14px 16px;
    border-radius: 18px;
    background: var(--surface);
  }

  .card h2,
  .section {
    margin: 0 0 6px;
    font-size: 1.25rem;
  }

  .card p {
    margin: 0 0 8px;
  }

  .muted {
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.88rem;
  }

  .error {
    color: var(--danger-fg);
  }

  .review {
    border: 2px solid var(--rain);
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .choices button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-height: 56px;
    padding: 8px 14px;
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
    text-align: left;
  }

  .choices button .small {
    font-weight: 400;
    color: var(--fg-muted);
  }

  .choices button.primary {
    border-color: var(--rain);
    background: var(--rain);
    color: var(--bg);
  }

  .choices button.primary .small {
    color: var(--bg);
  }

  .next-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .pick {
    display: flex;
    gap: 4px;
  }

  .pick button {
    width: 36px;
    height: 36px;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-weight: 700;
  }

  .pick button.on {
    border-color: var(--fg);
    color: var(--fg);
  }

  .rhythm {
    font-size: 1.05rem;
  }

  .list {
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
  }

  .list li {
    border-bottom: 1px solid var(--surface-2);
  }

  .list li:last-child {
    border-bottom: 0;
  }

  .list button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-height: 54px;
    padding: 8px 0;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 1.08rem;
    text-align: left;
  }

  .list button.thumbed {
    flex-direction: row;
    align-items: center;
    gap: 12px;
  }

  .thumb {
    display: grid;
    flex: none;
    width: 64px;
    place-items: center;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .family {
    margin: 16px 0 2px;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  ul.list:not(.plan) {
    padding: 0 14px;
    border-radius: 18px;
    background: var(--surface);
  }

  .big {
    width: 100%;
    min-height: 54px;
    border: 0;
    border-radius: 999px;
    background: var(--rain);
    color: var(--bg);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
  }

  .hint {
    margin: 10px 0 0 !important;
    color: var(--ok-fg);
    font-size: 0.95rem;
  }

  .proposal .row {
    display: flex;
    gap: 8px;
  }

  .proposal .row button {
    flex: 1;
    min-height: 44px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }

  .proposal .row button.primary {
    background: var(--rain);
    color: var(--bg);
  }

  .week {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    margin-bottom: 10px;
  }

  .week label {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .week input {
    width: 4.5em;
    min-height: 42px;
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 1.05rem;
    text-align: right;
  }

  .chart {
    display: block;
    width: 100%;
    height: auto;
    margin-top: 10px;
  }

  .history {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .history li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    border-bottom: 1px solid var(--surface-2);
  }

  .history li:last-child {
    border-bottom: 0;
  }

  .when {
    min-width: 86px;
    color: var(--fg-muted);
    font-size: 0.92rem;
  }

  .what {
    flex: 1;
    min-width: 0;
  }

  .icon {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--fg-muted);
  }

  .danger {
    min-height: 38px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--danger-bg);
    color: var(--danger-fg);
    font: inherit;
    font-weight: 600;
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
