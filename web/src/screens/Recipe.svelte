<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Recipe, RecipeContent } from '../../../shared/recipes.ts';
  import Icon from '../components/Icon.svelte';
  import KitchenMode from '../components/recipes/KitchenMode.svelte';
  import RecipeEditor from '../components/recipes/RecipeEditor.svelte';
  import RecipeView from '../components/recipes/RecipeView.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { loadPairing } from '../lib/phone.ts';
  import { canEditRecipe, emptyContent, handoff, previewSummary, rereadMessage, type ShownStep, timerLabel } from '../lib/recipes.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { detailPath, phonePath, phoneRecipePath, recipePath, type RecipeMode } from '../lib/route.ts';

  // Une recette du carnet : sa fiche, son édition (notre version, une nouvelle recette saisie à la main, ou l'aperçu
  // d'un texte collé ou d'une page enregistrée), et sur la tablette le mode cuisine. La page garde les données et les appels ; l'affichage est dans components/recipes/.
  // Sur la tablette, modifier demande quelqu'un de reconnu ; sur le téléphone, son profil agit. Le serveur décide.
  type Props = { id: string | null; mode: RecipeMode; phone?: boolean };
  let { id, mode, phone = false }: Props = $props();

  const { api, actor, config, timers, navigate } = getAppContext();
  const pairing = untrack(() => (phone ? loadPairing() : null));
  const phoneMember = config.members.find((m) => m.id === pairing?.ownerId);
  const nameOf = (ownerId: string | null) => (ownerId ? (config.members.find((m) => m.id === ownerId)?.name ?? null) : null);

  const recipe = createResource<Recipe | null>(async () => (id ? api.recipe(id) : null), 5 * 60_000);
  onDestroy(() => recipe.destroy());

  // Saisie à la main après un import illisible : titre prérempli, lien gardé. Ou aperçu d'un texte collé ou d'une
  // page enregistrée : ce qui a été compris, à corriger avant d'enregistrer (le serveur garde la source en attendant).
  const draft = untrack(() => (id === null ? handoff.draft : null));
  const preview = untrack(() => (id === null ? handoff.preview : null));
  handoff.draft = null;
  handoff.preview = null;
  /** Lien donné à l'aperçu d'un texte collé qui n'en contenait pas. */
  let previewLink = $state('');

  let servings = $state<number | null>(untrack(() => (id ? (handoff.servings.get(id) ?? null) : null)));
  $effect(() => {
    if (servings === null && recipe.data) servings = recipe.data.ours.servings;
  });
  $effect(() => {
    if (id && servings !== null) handoff.servings.set(id, servings);
  });

  let saving = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  /** Compte rendu de la dernière relecture de la page. */
  let info = $state<string | null>(null);
  let rereading = $state(false);

  const carnet = () => navigate(phone ? phonePath('recipes') : detailPath('recipes', { name: 'home' }));
  const pathOf = (target: string | null, next: RecipeMode) => (phone ? phoneRecipePath(target, next === 'cook' ? 'view' : next) : recipePath(target, next));

  /** Sur la tablette, attend quelqu'un de reconnu ; sur le téléphone, passe tout de suite. */
  const allowed = () => actor.allow(null);

  async function edit() {
    if (await allowed()) navigate(pathOf(id, 'edit'));
  }

  async function save(content: RecipeContent) {
    if (!(await allowed())) return;
    saving = true;
    error = null;
    try {
      const saved = id
        ? await api.saveRecipe(id, content)
        : preview
          ? await api.createRecipe(content, preview.url ?? (/^https?:\/\//iu.test(previewLink.trim()) ? previewLink.trim() : null), preview.token)
          : await api.createRecipe(content, draft?.url ?? null);
      handoff.servings.delete(saved.id);
      recipe.set(saved);
      navigate(pathOf(saved.id, 'view'));
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function reread() {
    if (!id || !(await allowed())) return;
    rereading = true;
    notice = info = null;
    try {
      const result = await api.rereadRecipe(id);
      recipe.set(result.recipe);
      info = rereadMessage(result.updated, result.kept);
    } catch (err) {
      notice = (err as Error).message;
    } finally {
      rereading = false;
    }
  }

  async function remove() {
    if (!id || !(await allowed())) return;
    try {
      await api.removeRecipe(id);
      carnet();
    } catch (err) {
      notice = (err as Error).message;
    }
  }

  async function startTimer(seconds: number, step: ShownStep) {
    const title = recipe.data?.ours.title ?? 'Recette';
    notice = (await timers.start(timerLabel(title, step.number), seconds)) ? null : 'Minuteur non lancé';
  }

  const editInitial = $derived(id === null ? (preview?.content ?? emptyContent(draft?.title ?? '')) : (recipe.data?.ours ?? null));
</script>

<div class="recipe-page" class:phone class:cook={mode === 'cook'}>
  {#if mode === 'cook' && recipe.data && !phone}
    <KitchenMode recipe={recipe.data} {servings} onTimer={startTimer} onExit={() => navigate(pathOf(id, 'view'))} />
  {:else}
    <header>
      {#if mode === 'edit'}
        <button type="button" class="btn" onclick={() => (id ? navigate(pathOf(id, 'view')) : carnet())}><Icon name="back" size={26} /> {id ? 'Fiche' : 'Recettes'}</button>
        <h1>{id ? 'Notre version' : preview ? 'Aperçu de l’import' : 'Nouvelle recette'}</h1>
      {:else}
        <button type="button" class="btn" onclick={carnet}><Icon name="back" size={26} /> Recettes</button>
        <h1>{recipe.data?.ours.title ?? ''}</h1>
      {/if}
    </header>

    {#if notice}<p class="error">{notice}</p>{/if}
    {#if info && mode !== 'edit'}<p class="info" role="status">{info}</p>{/if}

    {#if mode === 'edit' && editInitial}
      {#if preview}
        <div class="preview" role="status">
          <p>{previewSummary(preview)}</p>
          {#if preview.url}
            <p class="muted">D’après {preview.site} · {preview.url}</p>
          {:else}
            <label>
              <span class="muted">Lien de la page (facultatif)</span>
              <input type="url" inputmode="url" bind:value={previewLink} placeholder="https://…" />
            </label>
          {/if}
        </div>
      {:else if draft?.url}<p class="muted">Lien gardé : {draft.url}</p>{/if}
      {#key id}
        <RecipeEditor initial={editInitial} {phone} {saving} {error} onSave={save} onCancel={() => (id ? navigate(pathOf(id, 'view')) : carnet())} />
      {/key}
    {:else if recipe.data}
      {@const data = recipe.data}
      <RecipeView
        recipe={data}
        bind:servings
        photoUrl={data.photo ? api.recipePhotoUrl(data.id) : null}
        {phone}
        canEdit={phone ? canEditRecipe(phoneMember, data) : true}
        canRemove={phone ? phoneMember?.parent === true : true}
        addedBy={nameOf(data.addedBy.ownerId)}
        onEdit={edit}
        onRemove={remove}
        onReread={reread}
        {rereading}
        onCook={phone ? undefined : () => navigate(pathOf(data.id, 'cook'))}
        onTimer={phone ? undefined : startTimer}
      />
    {:else if recipe.error}
      <p class="muted">Impossible d’ouvrir la recette : {recipe.error}</p>
    {:else}
      <p class="muted">Chargement…</p>
    {/if}
  {/if}
</div>

<style>
  .recipe-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 100%;
    padding: var(--space-4) var(--space-6);
    box-sizing: border-box;
    overflow-y: auto;
  }

  .recipe-page.cook {
    padding: 0;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  h1 {
    min-width: 0;
    margin: 0;
    font-size: var(--text-heading);
    line-height: 1.15;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }

  .info {
    margin: 0;
    color: var(--fg-muted);
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .preview p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .preview label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .preview input {
    min-height: 48px;
    padding: 0 16px;
    border: 2px solid var(--surface-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, 1rem);
    user-select: text;
  }

  .phone {
    max-width: 640px;
    margin: 0 auto;
    padding: calc(14px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));
    height: 100dvh;
    gap: 14px;
  }

  .phone header {
    gap: 12px;
  }

  .phone h1 {
    font-size: 1.45rem;
  }

  .phone .btn {
    min-height: 44px;
    padding: 0 14px;
    font-size: 1rem;
  }
</style>
