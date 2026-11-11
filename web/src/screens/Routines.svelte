<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { RoutinePeriod, RoutineSettings, TimeWindow } from '../../../shared/types.ts';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import SaveStatus from '../components/SaveStatus.svelte';
  import { ApiError } from '../lib/api.ts';
  import { createAutoSave, requireParent, type SaveState } from '../lib/autosave.ts';
  import { getAppContext } from '../lib/context.ts';
  import { draftProblem, hasDay, MAX_STEPS, moveStep, newStepId, PERIODS, stepsOnDay, toggleDay, toInput, WEEK } from '../lib/routine-edit.ts';
  import type { PageRoute } from '../lib/route.ts';

  // Réglages des routines, ouverts depuis la roue dentée : les étapes du matin et du soir de chacun (nom, jours,
  // ordre) et les heures où elles s'affichent. Tout le monde peut regarder ; seul un parent reconnu enregistre.
  // Chaque modification s'enregistre d'elle-même (lib/autosave.ts) ; son état s'affiche dans le titre de la carte.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, actor, clock, profiles } = getAppContext();
  const members = profiles.filter((p) => !p.isFamily);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const PERIOD_TITLES: Record<RoutinePeriod, string> = { morning: 'Matin', evening: 'Soir' };
  const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  let saved = $state<RoutineSettings | null>(null);
  let draft = $state<RoutineSettings | null>(null);
  let loadError = $state<string | null>(null);
  let selected = $state(members[0]?.id ?? '');
  let adding = $state<Record<RoutinePeriod, string>>({ morning: '', evening: '' });
  let saveState = $state<SaveState>({ kind: 'idle' });

  const clone = (settings: RoutineSettings) => JSON.parse(JSON.stringify(settings)) as RoutineSettings;
  const dirty = $derived(Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)));
  const plan = $derived(draft?.members[selected]);
  const today = $derived(plan ? stepsOnDay(plan, clock.now) : null);

  onMount(async () => {
    try {
      saved = await api.routines();
      draft = clone(saved);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  });

  const auto = createAutoSave({
    problem: () => (draft ? draftProblem(draft, nameOf) : null),
    onState: (next) => (saveState = next),
    async save() {
      if (!draft || !dirty) return false;
      await requireParent(actor, 'Seul un parent peut modifier les routines');
      const sent = JSON.stringify(draft);
      try {
        saved = await api.saveRoutines(toInput(draft));
      } catch (err) {
        actor.check(err);
        throw new Error(err instanceof ApiError ? err.message : 'Enregistrement impossible');
      }
      // Ce qui a été modifié pendant l'envoi reste dans le brouillon (et repart au prochain enregistrement).
      if (JSON.stringify(draft) === sent) draft = clone(saved);
      return true;
    },
  });
  onDestroy(() => void auto.flush());

  const zoneOf = (period: RoutinePeriod) => `${selected}:${period}`;
  const edit = (zone: string) => auto.touch(zone);

  function addStep(period: RoutinePeriod) {
    const label = adding[period].trim();
    if (!plan || !label) return;
    if (plan[period].length >= MAX_STEPS) return auto.warn(zoneOf(period), `${MAX_STEPS} étapes au plus`);
    plan[period].push({ id: newStepId([...plan.morning, ...plan.evening]), label, days: null });
    adding[period] = '';
    edit(zoneOf(period));
  }

  function setWeekend(period: RoutinePeriod, range: TimeWindow | undefined) {
    if (!draft) return;
    const weekend = { ...draft.windows.weekend, [period]: range };
    if (!range) delete weekend[period];
    draft.windows.weekend = Object.keys(weekend).length ? weekend : undefined;
    edit('hours');
  }

  /** Revient à ce qui est enregistré (enregistrement refusé). */
  function undo() {
    if (saved) draft = clone(saved);
    auto.reset();
  }
</script>

{#snippet range(value: TimeWindow, label: string)}
  <span class="range">
    <input type="time" aria-label="{label} : début" bind:value={value.from} oninput={() => edit('hours')} />
    <span class="muted">–</span>
    <input type="time" aria-label="{label} : fin" bind:value={value.to} oninput={() => edit('hours')} />
  </span>
{/snippet}

<div class="routines-page">
  <header>
    <BackButton {back} />
    <h1>Routines</h1>
    <span class="who muted">
      <Icon name="lock" size={22} />
      {#if actor.current?.parent}
        {actor.current.name} peut modifier
      {:else}
        Seul un parent peut modifier
      {/if}
    </span>
  </header>

  {#if loadError}
    <p class="muted">Réglages indisponibles : {loadError}</p>
  {:else if draft && plan && today}
    <div class="members" role="tablist">
      {#each members as member (member.id)}
        <button
          type="button"
          role="tab"
          class="member"
          class:on={member.id === selected}
          aria-selected={member.id === selected}
          style:--member={member.color}
          onclick={() => (selected = member.id)}
        >
          <span class="dot"></span>{member.name}
        </button>
      {/each}
    </div>

    <div class="scroll">
      <div class="columns">
        {#each PERIODS as period (period)}
          <section class="card">
            <h2>
              <Icon name={period === 'morning' ? 'sun' : 'moon'} size={28} />
              {PERIOD_TITLES[period]}
              <SaveStatus state={saveState} zone={zoneOf(period)} onUndo={undo} />
            </h2>
            {#each plan[period] as step, i (step.id)}
              <div class="step">
                <span class="order">
                  <button type="button" aria-label="Monter « {step.label} »" disabled={i === 0} onclick={() => ((plan[period] = moveStep(plan[period], i, -1)), edit(zoneOf(period)))}>
                    <span class="up"><Icon name="chevron" size={20} /></span>
                  </button>
                  <button type="button" aria-label="Descendre « {step.label} »" disabled={i === plan[period].length - 1} onclick={() => ((plan[period] = moveStep(plan[period], i, 1)), edit(zoneOf(period)))}>
                    <span class="down"><Icon name="chevron" size={20} /></span>
                  </button>
                </span>
                <input class="label" type="text" maxlength="60" aria-label="Nom de l'étape" bind:value={step.label} oninput={() => edit(zoneOf(period))} />
                <span class="days">
                  {#each WEEK as { day, short, name } (day)}
                    <button
                      type="button"
                      class="day"
                      class:on={hasDay(step, day)}
                      aria-pressed={hasDay(step, day)}
                      aria-label="{step.label} le {name}"
                      onclick={() => ((plan[period][i] = toggleDay(step, day)), edit(zoneOf(period)))}>{short}</button
                    >
                  {/each}
                </span>
                <button type="button" class="remove" aria-label="Supprimer « {step.label} »" onclick={() => (plan[period].splice(i, 1), edit(zoneOf(period)))}>
                  <Icon name="trash" size={22} />
                </button>
              </div>
            {:else}
              <p class="muted empty">Pas de routine {period === 'morning' ? 'le matin' : 'le soir'}.</p>
            {/each}
            {#if plan[period].length < MAX_STEPS}
              <form class="add" onsubmit={(e) => (e.preventDefault(), addStep(period))}>
                <input type="text" maxlength="60" placeholder="Nouvelle étape" aria-label="Nouvelle étape, {PERIOD_TITLES[period].toLowerCase()}" bind:value={adding[period]} />
                <button type="submit" disabled={!adding[period].trim()}><Icon name="plus" size={22} /> Ajouter</button>
              </form>
            {/if}
          </section>
        {/each}
      </div>

      <section class="card hours">
        <h2>
          <Icon name="clock" size={28} /> Heures d'affichage <span class="muted small">(toute la famille)</span>
          <SaveStatus state={saveState} zone="hours" onUndo={undo} />
        </h2>
        <div class="hours-grid">
          <span></span>
          <span class="muted">Matin</span>
          <span class="muted">Soir</span>
          <span>En semaine</span>
          {@render range(draft.windows.morning, 'Matin en semaine')}
          {@render range(draft.windows.evening, 'Soir en semaine')}
          <span>Le week-end</span>
          {#each PERIODS as period (period)}
            {@const weekend = draft.windows.weekend?.[period]}
            {#if weekend}
              <span class="range">
                {@render range(weekend, `${PERIOD_TITLES[period]} le week-end`)}
                <button type="button" class="remove" aria-label="Comme en semaine" onclick={() => setWeekend(period, undefined)}><Icon name="close" size={20} /></button>
              </span>
            {:else}
              <button type="button" class="same" onclick={() => setWeekend(period, { ...draft!.windows[period] })}>Comme en semaine · changer</button>
            {/if}
          {/each}
        </div>
      </section>
    </div>

    <footer>
      <span class="muted">
        Aujourd'hui ({DAY_NAMES[clock.now.getDay()]}), {nameOf(selected)} : {today.morning} étape{today.morning > 1 ? 's' : ''} le matin,
        {today.evening} le soir · chaque modification s’enregistre d’elle-même
      </span>
    </footer>
  {/if}
</div>

<style>
  .routines-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 28px 40px 24px;
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

  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .muted {
    font-size: 1.1rem;
    color: var(--fg-muted);
  }

  .small {
    font-size: 1rem;
    font-weight: 400;
  }

  button {
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.35;
  }

  input {
    box-sizing: border-box;
    height: 48px;
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 1.15rem;
    user-select: text;
  }

  input:focus {
    outline: none;
    border-color: var(--rain);
  }

  .members {
    display: flex;
    gap: 10px;
  }

  .member {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 22px;
    border: 1px solid var(--border-strong);
    border-radius: 26px;
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--fg-soft);
  }

  .member.on {
    border-color: var(--member);
    background: color-mix(in srgb, var(--member) 22%, transparent);
    color: var(--fg);
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--member);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 18px;
    overflow-y: auto;
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 18px 20px;
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 8px;
    font-size: 1.4rem;
    font-weight: 600;
  }

  .step {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--surface-2);
  }

  .order {
    display: flex;
    flex-direction: column;
  }

  .order button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 26px;
    color: var(--fg-muted);
  }

  .up {
    display: grid;
    transform: rotate(-90deg);
  }

  .down {
    display: grid;
    transform: rotate(90deg);
  }

  .label {
    flex: 1;
    min-width: 0;
  }

  .days {
    display: flex;
    gap: 3px;
  }

  .day {
    width: 34px;
    height: 40px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--fg-muted);
  }

  .day.on {
    border-color: var(--rain);
    background: var(--rain-bg);
    color: var(--rain-soft);
  }

  .remove {
    display: grid;
    place-items: center;
    width: 40px;
    height: 44px;
    color: var(--fg-muted);
  }

  .empty {
    margin: 8px 0;
  }

  .add {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .add input {
    flex: 1;
    min-width: 0;
  }

  .add button,
  .same {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    padding: 0 16px;
    border-radius: 12px;
    background: var(--surface-2);
    font-size: 1.05rem;
    font-weight: 600;
  }

  .hours-grid {
    display: grid;
    grid-template-columns: 150px 1fr 1fr;
    align-items: center;
    gap: 10px 18px;
    font-size: 1.15rem;
  }

  .range {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .range input {
    width: 120px;
  }

  .same {
    justify-self: start;
    color: var(--fg-muted);
  }

  footer {
    display: flex;
    align-items: center;
    gap: 16px;
  }




</style>
