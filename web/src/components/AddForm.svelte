<script lang="ts" module>
  import type { Repeat } from '../../../shared/types.ts';

  export type AddKind = 'shopping' | 'task';
  export type AddInput = { kind: AddKind; label: string; ownerId: string; due: string | null; repeat: Repeat | null };
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { dueChoices, REPEAT_CHOICES } from '../lib/lists.ts';
  import type { Profile } from '../lib/profiles.ts';
  import Avatar from './Avatar.svelte';

  // Ajout d'un article de courses ou d'une tâche : sur la tablette (fenêtre) et sur le téléphone (volet du bas,
  // ouvert aussi depuis « Partager »).

  type Props = {
    kind?: AddKind;
    text?: string;
    /** Pour qui, par défaut. */
    ownerId: string;
    profiles: Profile[];
    now: Date;
    /** Ligne affichée sous le titre (ex. « partagé depuis une autre appli »). */
    note?: string;
    onSubmit(input: AddInput): Promise<void>;
    onCancel(): void;
  };
  let { kind: initialKind = 'task', text = '', ownerId: initialOwner, profiles, now, note, onSubmit, onCancel }: Props = $props();

  // Valeurs de départ : le formulaire est recréé à chaque ouverture.
  let kind = $state(untrack(() => initialKind));
  let label = $state(untrack(() => text));
  let ownerId = $state(untrack(() => initialOwner));
  let due = $state<string | null>(null);
  let repeat = $state<Repeat | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const choices = $derived(dueChoices(now));
  const customDue = $derived(due !== null && !choices.some((c) => c.value === due));
  const repeatKey = (value: Repeat | null) => (value ? `${value.every}-${value.unit}` : 'none');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!label.trim() || busy) return;
    busy = true;
    error = null;
    try {
      await onSubmit({ kind, label: label.trim(), ownerId, due: kind === 'task' ? due : null, repeat: kind === 'task' ? repeat : null });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<form class="add-form" onsubmit={submit}>
  <div class="title-row">
    <h2>Ajouter</h2>
    {#if note}<span class="muted">{note}</span>{/if}
  </div>

  <!-- svelte-ignore a11y_autofocus -->
  <textarea bind:value={label} rows="2" maxlength="120" placeholder={kind === 'task' ? 'Ex. Sortir les poubelles' : 'Ex. Lait'} autofocus></textarea>

  <div class="segmented" role="radiogroup" aria-label="Liste">
    <button type="button" role="radio" aria-checked={kind === 'shopping'} class:on={kind === 'shopping'} onclick={() => (kind = 'shopping')}>
      Courses
    </button>
    <button type="button" role="radio" aria-checked={kind === 'task'} class:on={kind === 'task'} onclick={() => (kind = 'task')}>
      Tâche
    </button>
  </div>

  {#if kind === 'task'}
    <fieldset>
      <legend>Pour qui</legend>
      <div class="people">
        {#each profiles as profile (profile.id)}
          <button
            type="button"
            class="person"
            class:on={ownerId === profile.id}
            aria-pressed={ownerId === profile.id}
            aria-label={profile.name}
            style:--accent={profile.color}
            onclick={() => (ownerId = profile.id)}
          >
            <Avatar {profile} size={48} />
          </button>
        {/each}
      </div>
    </fieldset>

    <fieldset>
      <legend>Quand</legend>
      <div class="chips">
        {#each choices as choice (choice.label)}
          <button type="button" class="chip" class:on={due === choice.value} onclick={() => (due = choice.value)}>{choice.label}</button>
        {/each}
        <label class="chip date" class:on={customDue}>
          <input type="date" value={customDue ? due : ''} onchange={(e) => (due = e.currentTarget.value || null)} />
        </label>
      </div>
    </fieldset>

    <fieldset>
      <legend>Répéter</legend>
      <div class="chips">
        {#each REPEAT_CHOICES as choice (choice.label)}
          <button
            type="button"
            class="chip"
            class:on={repeatKey(repeat) === repeatKey(choice.value)}
            onclick={() => (repeat = choice.value)}
          >
            {choice.label}
          </button>
        {/each}
      </div>
    </fieldset>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}

  <div class="actions">
    <button type="button" class="secondary" onclick={onCancel}>Annuler</button>
    <button type="submit" class="primary" disabled={!label.trim() || busy}>
      {kind === 'task' ? 'Ajouter la tâche' : 'Ajouter aux courses'}
    </button>
  </div>
</form>

<style>
  .add-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 700;
  }

  .muted {
    font-size: 0.9rem;
    color: var(--fg-muted);
  }

  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 14px 16px;
    border: 2px solid var(--rain);
    border-radius: 16px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 1.2rem;
    resize: none;
    user-select: text;
  }

  .segmented {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 5px;
    border-radius: 16px;
    background: var(--bg);
  }

  .segmented button {
    min-height: 46px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .segmented button.on {
    background: var(--surface-2);
    color: var(--fg);
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: 10px;
    padding: 0;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .people {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .person {
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    opacity: 0.45;
  }

  .person.on {
    opacity: 1;
    outline: 3px solid var(--fg);
    outline-offset: 3px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    min-height: 42px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
  }

  .chip.on {
    background: var(--fg);
    color: var(--bg);
  }

  .date input {
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    color-scheme: dark;
  }

  .chip.date.on input {
    color-scheme: light;
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }

  .actions {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
  }

  .actions button {
    min-height: 56px;
    padding: 0 22px;
    border: 0;
    border-radius: 18px;
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
  }

  .primary {
    background: var(--rain);
    color: var(--bg);
  }

  .primary:disabled {
    opacity: 0.5;
  }

  .secondary {
    background: var(--surface-2);
    color: var(--fg);
  }
</style>
