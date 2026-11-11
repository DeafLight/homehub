<script lang="ts">
  import { onDestroy } from 'svelte';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import ImportForm from '../components/recipes/ImportForm.svelte';
  import RecipeCards from '../components/recipes/RecipeCards.svelte';
  import Modal from '../components/stock/Modal.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { handoff, searchRecipes } from '../lib/recipes.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { type PageRoute, recipePath } from '../lib/route.ts';

  // Carnet de recettes sur la tablette : recherche, filtre Cookeo, cartes ; importer un lien (le plus souvent, on
  // partage depuis le téléphone), coller le texte d'une page ou envoyer une page enregistrée (site qui refuse la
  // lecture), ou saisir une recette à la main. Importer demande quelqu'un de reconnu.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, actor, navigate } = getAppContext();
  const list = createResource(() => api.recipes(), 60_000);
  onDestroy(() => list.destroy());

  let search = $state('');
  let cookeo = $state(false);
  let importing = $state(false);

  const shown = $derived(list.data ? searchRecipes(list.data.recipes, search, cookeo) : []);
  const hasCookeo = $derived(list.data?.recipes.some((r) => r.appliance === 'cookeo') ?? false);

  async function openImport() {
    if (await actor.allow(null)) importing = true;
  }

  async function manual(draft: typeof handoff.draft) {
    if (!(await actor.allow(null))) return;
    handoff.draft = draft;
    navigate(recipePath(null));
  }

  /** Aperçu d'un texte collé ou d'une page enregistrée : il s'ouvre dans l'édition d'une nouvelle recette. */
  function preview(found: NonNullable<typeof handoff.preview>) {
    handoff.preview = found;
    navigate(recipePath(null));
  }
</script>

<div class="recipes-page">
  <header>
    <BackButton {back} />
    <h1>Recettes</h1>
    <input class="search" type="search" bind:value={search} placeholder="Chercher une recette" aria-label="Chercher une recette" />
    {#if hasCookeo}
      <button type="button" class="btn" class:on={cookeo} aria-pressed={cookeo} onclick={() => (cookeo = !cookeo)}>Cookeo</button>
    {/if}
    <button type="button" class="btn primary" onclick={openImport}><Icon name="plus" size={24} /> Ajouter</button>
  </header>

  <div class="scroll">
    {#if list.data}
      {#if list.data.recipes.length === 0}
        <div class="empty">
          <Icon name="book" size={64} color="var(--fg-muted)" />
          <h2>Le carnet est vide</h2>
          <p>Sur un téléphone relié, ouvre une recette (Marmiton, Jow, Cookeo…), touche <strong>Partager</strong> puis <strong>HomeHub</strong>. Elle arrive ici, et notre version se modifie à volonté.</p>
        </div>
      {:else if shown.length === 0}
        <p class="muted">Aucune recette ne correspond.</p>
      {:else}
        <RecipeCards recipes={shown} photoUrl={api.recipePhotoUrl} onOpen={(r) => navigate(recipePath(r.id))} />
      {/if}
    {:else if list.error}
      <p class="muted">Impossible de charger le carnet : {list.error}</p>
    {/if}
  </div>
</div>

{#if importing}
  <Modal label="Importer une recette" onClose={() => (importing = false)}>
    <ImportForm
      onImport={(url) => api.importRecipe(url)}
      onText={(text, url, title) => api.importRecipeText(text, url, title)}
      onPage={(page) => api.importSavedPage(page)}
      onPreview={preview}
      onOpen={(recipe) => navigate(recipePath(recipe.id))}
      onManual={manual}
      onCancel={() => (importing = false)}
    />
  </Modal>
{/if}

<style>
  .recipes-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 100%;
    padding: var(--space-4) var(--space-6);
    box-sizing: border-box;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  h1 {
    margin: 0;
    font-size: var(--text-display);
  }

  .search {
    flex: 1;
    min-width: 0;
    max-width: 420px;
    min-height: 52px;
    margin-left: auto;
    padding: 0 20px;
    border: 2px solid var(--surface-2);
    border-radius: 999px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, var(--text-body));
  }

  .btn.on {
    background: var(--warn-bg);
    color: var(--sun);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .muted {
    color: var(--fg-muted);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    max-width: 640px;
    margin: var(--space-6) auto;
    text-align: center;
  }

  .empty h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  .empty p {
    margin: 0;
    color: var(--fg-soft);
    font-size: var(--text-body);
    line-height: 1.5;
  }
</style>
