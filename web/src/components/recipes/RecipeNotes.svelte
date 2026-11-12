<script lang="ts">
  import { RECIPE_NOTE_LIMITS, type NotePatch, type RecipeNote, splitNotes } from '../../../../shared/recipe-notes.ts';
  import { noteMeta } from '../../lib/recipes.ts';
  import Icon from '../Icon.svelte';

  // Notes de la famille sur une recette, dans la fiche (tablette et téléphone) : les notes ouvertes, signées et datées,
  // puis les résolues, repliées et toujours consultables. Chacun laisse une note ; son auteur ou un parent la modifie,
  // la résout, la rouvre ou la retire (`canChange` anticipe seulement : le serveur décide). Affichage seul : la page
  // fait les appels, et rend vrai quand ils ont réussi (le champ se vide, l'édition se ferme).
  type Props = {
    notes: RecipeNote[] | null;
    phone?: boolean;
    /** Peut-on écrire une note (téléphone appairé, tablette) ? */
    canAdd: boolean;
    canChange: (note: RecipeNote) => boolean;
    nameOf: (ownerId: string) => string;
    colorOf: (ownerId: string) => string;
    error: string | null;
    onAdd: (text: string) => Promise<boolean>;
    onChange: (note: RecipeNote, patch: NotePatch) => Promise<boolean>;
    onRemove: (note: RecipeNote) => Promise<boolean>;
  };
  let { notes, phone = false, canAdd, canChange, nameOf, colorOf, error, onAdd, onChange, onRemove }: Props = $props();

  const groups = $derived(splitNotes(notes ?? []));
  let draft = $state('');
  let busy = $state(false);
  let showResolved = $state(false);
  /** Note en cours de modification, et son texte. */
  let editing = $state<string | null>(null);
  let editText = $state('');
  /** Note dont on confirme le retrait. */
  let removing = $state<string | null>(null);
  const now = new Date();

  async function run(action: () => Promise<boolean>, done: () => void = () => {}) {
    busy = true;
    try {
      if (await action()) done();
    } finally {
      busy = false;
    }
  }

  const add = () => run(() => onAdd(draft), () => (draft = ''));
  const save = (note: RecipeNote) => run(() => onChange(note, { text: editText }), () => (editing = null));
  const remove = (note: RecipeNote) => run(() => onRemove(note), () => (removing = null));

  function startEdit(note: RecipeNote) {
    editing = note.id;
    editText = note.text;
    removing = null;
  }
</script>

{#snippet item(note: RecipeNote)}
  <li class:resolved={note.resolvedAt !== undefined} style:--owner={colorOf(note.by.ownerId)}>
    {#if editing === note.id}
      <textarea bind:value={editText} rows="3" maxlength={RECIPE_NOTE_LIMITS.text} aria-label="Texte de la note"></textarea>
      <div class="tools">
        <button type="button" class="btn small primary" disabled={busy || !editText.trim()} onclick={() => save(note)}>Enregistrer</button>
        <button type="button" class="btn small" onclick={() => (editing = null)}>Annuler</button>
      </div>
    {:else}
      <p class="text">{note.text}</p>
      <p class="meta">{noteMeta(note, nameOf, now)}</p>
      {#if canChange(note)}
        <div class="tools">
          {#if note.resolvedAt === undefined}
            <button type="button" class="btn small" disabled={busy} onclick={() => run(() => onChange(note, { resolved: true }))}><Icon name="check" size={20} /> Résolu</button>
            <button type="button" class="btn small" aria-label="Modifier la note" onclick={() => startEdit(note)}><Icon name="pencil" size={20} /></button>
          {:else}
            <button type="button" class="btn small" disabled={busy} onclick={() => run(() => onChange(note, { resolved: false }))}><Icon name="undo" size={20} /> Rouvrir</button>
          {/if}
          {#if removing === note.id}
            <button type="button" class="btn small danger" disabled={busy} onclick={() => remove(note)}>Retirer la note ?</button>
            <button type="button" class="btn small" onclick={() => (removing = null)}>Garder</button>
          {:else}
            <button type="button" class="btn small" aria-label="Retirer la note" onclick={() => (removing = note.id)}><Icon name="trash" size={20} /></button>
          {/if}
        </div>
      {/if}
    {/if}
  </li>
{/snippet}

<section class="notes" class:phone aria-label="Notes de la famille">
  <h2 class="card-label">Notes{groups.open.length ? ` · ${groups.open.length}` : ''}</h2>

  {#if notes === null}
    <p class="muted">Chargement…</p>
  {:else}
    {#if groups.open.length}
      <ul>
        {#each groups.open as note (note.id)}{@render item(note)}{/each}
      </ul>
    {:else}
      <p class="muted">Aucune note pour l’instant{canAdd ? ' : « moins salé la prochaine fois », « sans champignons pour Tom »…' : '.'}</p>
    {/if}

    {#if groups.resolved.length}
      <button type="button" class="toggle" aria-expanded={showResolved} onclick={() => (showResolved = !showResolved)}>
        <Icon name="chevron" size={18} /> {groups.resolved.length === 1 ? '1 note résolue' : `${groups.resolved.length} notes résolues`}
      </button>
      {#if showResolved}
        <ul>
          {#each groups.resolved as note (note.id)}{@render item(note)}{/each}
        </ul>
      {/if}
    {/if}
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if canAdd}
    <form class="add" onsubmit={(event) => (event.preventDefault(), add())}>
      <textarea bind:value={draft} rows="2" maxlength={RECIPE_NOTE_LIMITS.text} placeholder="Une note pour la prochaine fois…" aria-label="Nouvelle note"></textarea>
      <button type="submit" class="btn small primary" disabled={busy || !draft.trim()}><Icon name="message" size={20} /> Ajouter</button>
    </form>
  {/if}
</section>

<style>
  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 14px;
    border-left: 4px solid var(--owner, var(--surface-2));
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  li.resolved {
    border-left-color: var(--border-strong);
    background: transparent;
    color: var(--fg-muted);
  }

  li.resolved .text {
    text-decoration: line-through;
    text-decoration-color: var(--fg-muted);
  }

  .text {
    margin: 0;
    font-size: var(--text-body);
    line-height: 1.4;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .meta {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-small);
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    min-height: 44px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-size: var(--text-small);
    cursor: pointer;
  }

  .toggle[aria-expanded='true'] :global(svg) {
    transform: rotate(90deg);
  }

  .add {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .add button {
    align-self: flex-end;
  }

  textarea {
    width: 100%;
    min-height: 48px;
    padding: 8px 14px;
    border: 2px solid var(--surface-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, 1rem);
    box-sizing: border-box;
    resize: vertical;
    user-select: text;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }

  .btn.danger {
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  .phone .text {
    font-size: 1.05rem;
  }
</style>
