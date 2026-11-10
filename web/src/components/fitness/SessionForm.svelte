<script lang="ts">
  import { untrack } from 'svelte';
  import { FAMILY_LABELS } from '../../../../shared/fitness-catalogue.ts';
  import {
    NOTE_MAX,
    PAIN_LABELS,
    PAIN_SPOTS,
    type PainSpot,
    type PlannedExercise,
    type Rating,
    RATING_LABELS,
    RPE_LABELS,
    type SessionNumber,
  } from '../../../../shared/fitness.ts';
  import type { SessionReport } from '../../lib/api.ts';

  // Fin de séance : ressenti global (il règle le rythme de la semaine suivante), puis, pour chaque exercice, la
  // difficulté, une gêne éventuelle et où, les répétitions et une note, tous facultatifs.
  type Props = {
    session: SessionNumber;
    plan: PlannedExercise[];
    onSubmit: (report: SessionReport) => Promise<void>;
    onCancel: () => void;
  };
  let { session, plan, onSubmit, onCancel }: Props = $props();

  type Draft = { rating: Rating | null; painOn: boolean; pain: PainSpot | null; reps: number | null; note: string };
  let rpe = $state<number | null>(null);
  let stopped = $state(false);
  let note = $state('');
  let drafts = $state<Draft[]>(untrack(() => plan.map(() => ({ rating: null, painOn: false, pain: null, reps: null, note: '' }))));
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function save() {
    if (rpe === null) {
      error = 'Choisis d’abord ton ressenti global.';
      return;
    }
    saving = true;
    error = null;
    try {
      await onSubmit({
        session,
        rpe,
        stopped,
        note: note.trim() || null,
        exercises: plan.map(({ family }, i) => {
          const d = drafts[i];
          const reps = typeof d.reps === 'number' ? Math.round(d.reps) : null;
          return {
            family,
            rating: d.rating,
            pain: d.painOn ? (d.pain ?? 'autre') : null,
            reps: reps !== null && Number.isFinite(reps) && reps >= 0 ? Math.min(reps, 999) : null,
            note: d.note.trim() || null,
          };
        }),
      });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<form
  class="form"
  onsubmit={(e) => {
    e.preventDefault();
    void save();
  }}
>
  <h2>Séance {session} terminée</h2>

  <fieldset class="block">
    <legend>Ressenti global</legend>
    <div class="rpe">
      {#each [1, 2, 3, 4, 5] as value (value)}
        <button type="button" class:on={rpe === value} aria-pressed={rpe === value} onclick={() => (rpe = value)}>
          <strong>{value}</strong><span>{RPE_LABELS[value]}</span>
        </button>
      {/each}
    </div>
    <label class="check"><input type="checkbox" bind:checked={stopped} /> Arrêtée avant la fin</label>
  </fieldset>

  {#each plan as item, i (item.family)}
    {@const d = drafts[i]}
    <fieldset class="block">
      <legend>{item.exercise.name}</legend>
      <p class="family">{FAMILY_LABELS[item.family]}</p>
      <div class="seg" role="group" aria-label="Difficulté">
        {#each ['facile', 'ok', 'dur'] as const as r (r)}
          <button type="button" class:on={d.rating === r} aria-pressed={d.rating === r} onclick={() => (d.rating = d.rating === r ? null : r)}>
            {RATING_LABELS[r]}
          </button>
        {/each}
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" bind:checked={drafts[i].painOn} /> Gêne</label>
        <label class="reps">
          <input type="number" inputmode="numeric" min="0" max="999" bind:value={drafts[i].reps} placeholder="—" />
          {item.exercise.unit === 's' ? 's tenues' : 'rép.'} / tour
        </label>
      </div>
      {#if d.painOn}
        <div class="spots" role="group" aria-label="Où ?">
          {#each PAIN_SPOTS as spot (spot)}
            <button type="button" class:on={d.pain === spot} aria-pressed={d.pain === spot} onclick={() => (d.pain = spot)}>{PAIN_LABELS[spot]}</button>
          {/each}
        </div>
      {/if}
      <input class="note" type="text" maxlength={NOTE_MAX} bind:value={drafts[i].note} placeholder="Ressenti, adaptation… (facultatif)" />
    </fieldset>
  {/each}

  <fieldset class="block">
    <legend>Note sur la séance</legend>
    <textarea maxlength={NOTE_MAX} rows="2" bind:value={note} placeholder="Facultatif"></textarea>
  </fieldset>

  {#if error}<p class="error">{error}</p>{/if}
  <div class="actions">
    <button type="button" class="ghost" onclick={onCancel}>Annuler</button>
    <button type="submit" class="primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
  </div>
</form>

<style>
  .form h2 {
    margin: 0 0 12px;
    font-size: 1.35rem;
  }

  .block {
    margin: 0 0 12px;
    padding: 12px 14px;
    border: 0;
    border-radius: 18px;
    background: var(--surface);
  }

  legend {
    float: left;
    width: 100%;
    margin-bottom: 8px;
    padding: 0;
    font-size: 1.1rem;
    font-weight: 700;
  }

  .family {
    clear: both;
    margin: -6px 0 8px;
    color: var(--fg-muted);
    font-size: 0.9rem;
  }

  .rpe {
    display: grid;
    clear: both;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }

  .rpe button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 62px;
    padding: 6px 2px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: none;
    color: var(--fg);
    font: inherit;
  }

  .rpe strong {
    font-size: 1.3rem;
  }

  .rpe span {
    font-size: 0.72rem;
    color: var(--fg-muted);
  }

  .rpe button.on,
  .seg button.on,
  .spots button.on {
    border-color: var(--rain);
    background: var(--rain);
    color: var(--bg);
  }

  .rpe button.on span {
    color: var(--bg);
  }

  .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .seg button,
  .spots button {
    min-height: 44px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 10px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    margin-top: 6px;
  }

  .check input {
    width: 22px;
    height: 22px;
    margin: 0;
  }

  .reps {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-muted);
    font-size: 0.9rem;
  }

  .reps input {
    width: 4.2em;
    min-height: 40px;
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 1.05rem;
    text-align: right;
  }

  .spots {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .spots button {
    padding: 0 12px;
  }

  .note,
  textarea {
    box-sizing: border-box;
    width: 100%;
    margin-top: 10px;
    padding: 8px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }

  textarea {
    clear: both;
    margin-top: 0;
    resize: vertical;
  }

  .error {
    color: var(--danger-fg);
  }

  .actions {
    display: flex;
    gap: 10px;
    margin-top: 6px;
  }

  .actions button {
    flex: 1;
    min-height: 52px;
    border: 0;
    border-radius: 999px;
    font: inherit;
    font-weight: 700;
  }

  .ghost {
    background: var(--surface-2);
    color: var(--fg);
  }

  .primary {
    background: var(--rain);
    color: var(--bg);
  }
</style>
