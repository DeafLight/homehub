<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ImportPreview, Recipe, RecipeDraft } from '../../../../shared/recipes.ts';
  import type { ImportResponse, OfflineImportResponse } from '../../lib/api.ts';
  import Icon from '../Icon.svelte';

  // Importer une recette. Par un lien (collé, ou reçu par « Partager ») : le serveur lit la page ; recette trouvée (ou
  // déjà au carnet), on l'ouvre ; rien de lisible, la raison et « Saisir à la main ». Quand le site refuse la lecture
  // par HomeHub, deux chemins passent par le navigateur de la personne : coller le texte copié de la page, ou
  // envoyer la page enregistrée (.mhtml) ; tous deux donnent un aperçu à corriger avant d'enregistrer.
  type Props = {
    link?: string;
    note?: string;
    /** Texte reçu par « Partager » (copié d'une page) : lu tout de suite. */
    sharedText?: { text: string; link: string | null; title: string | null };
    /** Page enregistrée reçue par « Partager », déposée sur le serveur : réclamée tout de suite. */
    sharedPage?: string;
    /** Erreur venue du partage (fichier trop lourd). */
    initialError?: string;
    onImport: (url: string) => Promise<ImportResponse>;
    onText: (text: string, url: string | null, title: string | null) => Promise<OfflineImportResponse>;
    onPage: (page: File | { shared: string }) => Promise<OfflineImportResponse>;
    onOpen: (recipe: Recipe, existing: boolean) => void;
    onPreview: (preview: ImportPreview['preview']) => void;
    onManual: (draft: RecipeDraft | null) => void;
    onCancel: () => void;
    /** Autre choix proposé (« Ajouter à une liste » quand le lien vient de « Partager »). */
    other?: { label: string; run: () => void };
  };
  let { link = '', note, sharedText, sharedPage, initialError, onImport, onText, onPage, onOpen, onPreview, onManual, onCancel, other }: Props = $props();

  type Mode = 'link' | 'text';
  let mode = $state<Mode>(untrack(() => (sharedText ? 'text' : 'link')));
  let url = $state(untrack(() => link));
  let text = $state(untrack(() => sharedText?.text ?? ''));
  /** Lien facultatif donné avec un texte (sinon pris dans le texte). */
  let textLink = $state(untrack(() => sharedText?.link ?? (link || '')));
  let busy = $state<string | null>(null);
  let error = $state<string | null>(untrack(() => initialError ?? null));
  let draft = $state<{ draft: RecipeDraft; reason: string; refused?: boolean } | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  const canPaste = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  async function run<T>(label: string, task: () => Promise<T>): Promise<T | null> {
    busy = label;
    error = null;
    try {
      return await task();
    } catch (err) {
      error = (err as Error).message;
      return null;
    } finally {
      busy = null;
    }
  }

  function offline(result: OfflineImportResponse | null) {
    if (!result) return;
    if ('recipe' in result) onOpen(result.recipe, result.existing);
    else onPreview(result.preview);
  }

  async function submitLink(event: SubmitEvent) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    draft = null;
    const result = await run('Lecture de la page…', () => onImport(url.trim()));
    if (!result) return;
    if ('recipe' in result) onOpen(result.recipe, result.existing);
    else {
      draft = result;
      if (result.refused) textLink = result.draft.url;
    }
  }

  async function submitText(event?: SubmitEvent) {
    event?.preventDefault();
    if (!text.trim() || busy) return;
    offline(await run('Lecture du texte…', () => onText(text, textLink.trim() || null, sharedText?.title ?? null)));
  }

  async function paste() {
    try {
      const pasted = await navigator.clipboard.readText();
      if (pasted.trim()) text = pasted;
      else error = 'Le presse-papiers est vide : copie d’abord le texte de la recette';
    } catch {
      error = 'Collage refusé : appuie longuement dans la zone de texte, puis « Coller »';
    }
  }

  async function pickPage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) offline(await run('Lecture de la page enregistrée…', () => onPage(file)));
  }

  onMount(() => {
    if (sharedPage) void run('Lecture de la page enregistrée…', () => onPage({ shared: sharedPage })).then(offline);
    else if (sharedText) void submitText();
  });
</script>

<div class="import">
  <h2>Importer une recette</h2>
  {#if note}<p class="muted">{note}</p>{/if}

  {#if mode === 'link'}
    <form class="block" onsubmit={submitLink}>
      <label>
        <span class="muted">Lien de la recette (Marmiton, Jow, Cookeo, ou tout site de recettes)</span>
        <input type="url" inputmode="url" bind:value={url} placeholder="https://…" required />
      </label>
      <div class="actions">
        <button type="submit" class="btn primary" disabled={busy !== null || !url.trim()}><Icon name="link" size={22} /> Importer</button>
        <button type="button" class="btn" onclick={onCancel}>Annuler</button>
        {#if other}<span class="spacer"></span><button type="button" class="btn" onclick={other.run}>{other.label}</button>{/if}
      </div>
    </form>
  {:else}
    <form class="block" onsubmit={submitText}>
      <label>
        <span class="muted">Texte de la page : « Tout sélectionner », « Copier », puis colle-le ici. Le menu, les publicités et les commentaires sont ignorés.</span>
        <textarea bind:value={text} rows="7" placeholder="Colle ici le texte de la recette"></textarea>
      </label>
      <label>
        <span class="muted">Lien de la page (facultatif)</span>
        <input type="url" inputmode="url" bind:value={textLink} placeholder="https://…" />
      </label>
      <div class="actions">
        {#if canPaste}<button type="button" class="btn" onclick={paste} disabled={busy !== null}><Icon name="list" size={22} /> Coller</button>{/if}
        <button type="submit" class="btn primary" disabled={busy !== null || !text.trim()}><Icon name="check" size={22} /> Lire le texte</button>
        <button type="button" class="btn" onclick={() => (mode = 'link')}>Retour au lien</button>
      </div>
    </form>
  {/if}

  {#if busy}
    <p class="muted" role="status">{busy}</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if draft?.refused}
    <div class="draft">
      <p><strong>{draft.reason}.</strong></p>
      <p class="small">Sur le téléphone, dans la page : ⋮ puis « Tout sélectionner » et « Copier » ; ou ⋮ puis ⬇ pour l’enregistrer, et dans les téléchargements, « Partager » vers HomeHub.</p>
    </div>
  {:else if draft}
    <div class="draft">
      <p><strong>{draft.reason}.</strong> {draft.draft.title ? `« ${draft.draft.title} » : ` : ''}tu peux la saisir à la main, le lien est gardé.</p>
      <button type="button" class="btn primary" onclick={() => onManual(draft?.draft ?? null)}><Icon name="pencil" size={22} /> Saisir à la main</button>
    </div>
  {/if}

  <div class="others" class:highlight={draft?.refused}>
    <span class="muted small">Le site refuse la lecture ? Passe par ton navigateur :</span>
    <div class="actions">
      {#if mode === 'link'}
        <button type="button" class="btn" class:primary={draft?.refused} onclick={() => (mode = 'text')} disabled={busy !== null}><Icon name="list" size={22} /> Coller le texte</button>
      {/if}
      <button type="button" class="btn" class:primary={draft?.refused} onclick={() => fileInput?.click()} disabled={busy !== null}><Icon name="share" size={22} /> Page enregistrée</button>
      <input bind:this={fileInput} class="file" type="file" accept=".mhtml,.mht,multipart/related,message/rfc822,application/x-mimearchive" onchange={pickPage} />
    </div>
  </div>
  <button type="button" class="manual" onclick={() => onManual(draft?.draft ?? null)}>Ou saisir une recette à la main</button>
</div>

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

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  input,
  textarea {
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

  textarea {
    padding: 12px 16px;
    resize: vertical;
    line-height: 1.4;
  }

  .file {
    display: none;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
  }

  .small {
    font-size: var(--text-small);
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

  .others {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-top: var(--space-2);
    border-top: 1px solid var(--surface-2);
  }

  .others.highlight {
    border-top-color: var(--border-strong);
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
