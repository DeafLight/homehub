<script lang="ts">
  import { untrack } from 'svelte';
  import type { Recipe, RecipeDraft } from '../../../../shared/recipes.ts';
  import type { ImportResponse } from '../../lib/api.ts';
  import Icon from '../Icon.svelte';

  // Importer une recette depuis un lien (collé, ou reçu par « Partager ») : le serveur lit la page. Recette trouvée
  // (ou déjà au carnet) : on l'ouvre. Rien de lisible : la raison, et « Saisir à la main » avec le titre prérempli.
  type Props = {
    link?: string;
    note?: string;
    onImport: (url: string) => Promise<ImportResponse>;
    onOpen: (recipe: Recipe, existing: boolean) => void;
    onManual: (draft: RecipeDraft | null) => void;
    onCancel: () => void;
    /** Autre choix proposé (« Ajouter à une liste » quand le lien vient de « Partager »). */
    other?: { label: string; run: () => void };
  };
  let { link = '', note, onImport, onOpen, onManual, onCancel, other }: Props = $props();

  let url = $state(untrack(() => link));
  let busy = $state(false);
  let error = $state<string | null>(null);
  let draft = $state<{ draft: RecipeDraft; reason: string } | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    busy = true;
    error = null;
    draft = null;
    try {
      const result = await onImport(url.trim());
      if ('recipe' in result) onOpen(result.recipe, result.existing);
      else draft = result;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<form class="import" onsubmit={submit}>
  <h2>Importer une recette</h2>
  {#if note}<p class="muted">{note}</p>{/if}
  <label>
    <span class="muted">Lien de la recette (Marmiton, Jow, Cookeo, ou tout site de recettes)</span>
    <input type="url" inputmode="url" bind:value={url} placeholder="https://…" required />
  </label>

  {#if busy}
    <p class="muted">Lecture de la page…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if draft}
    <div class="draft">
      <p><strong>{draft.reason}.</strong> {draft.draft.title ? `« ${draft.draft.title} » : ` : ''}tu peux la saisir à la main, le lien est gardé.</p>
      <button type="button" class="btn primary" onclick={() => onManual(draft?.draft ?? null)}><Icon name="pencil" size={22} /> Saisir à la main</button>
    </div>
  {/if}

  <div class="actions">
    <button type="submit" class="btn primary" disabled={busy || !url.trim()}><Icon name="link" size={22} /> Importer</button>
    <button type="button" class="btn" onclick={onCancel}>Annuler</button>
    {#if other}<span class="spacer"></span><button type="button" class="btn" onclick={other.run}>{other.label}</button>{/if}
  </div>
  <button type="button" class="manual" onclick={() => onManual(null)}>Ou saisir une recette sans lien</button>
</form>

<style>
  .import {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  input {
    min-height: 52px;
    padding: 0 16px;
    border: 2px solid var(--surface-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, 1.1rem);
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

  .draft {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--warn-bg);
  }

  .draft p {
    margin: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .spacer {
    flex: 1;
  }

  .manual {
    align-self: center;
    padding: 8px;
    border: 0;
    background: none;
    color: var(--rain-soft);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
</style>
