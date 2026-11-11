<script lang="ts">
  import { formatMinutes, type Recipe, type RecipeContent } from '../../../../shared/recipes.ts';
  import { durationText, groupBySection, servingsText, shownIngredients, shownSteps, type ShownStep } from '../../lib/recipes.ts';
  import Icon from '../Icon.svelte';

  // Fiche d'une recette : notre version (portions ajustables, quantités recalculées, étapes avec leurs minuteurs et
  // leur mode Cookeo, nos astuces), et la source telle que lue, consultable à côté. Sur la tablette, deux colonnes
  // et le mode cuisine ; sur le téléphone, une colonne. « Relire la page » (vue source, ou fiche sans étapes ou sans
  // ingrédients) reprend ce que la page donne de nouveau sans écraser notre version. Affichage seul : les actions
  // remontent par les rappels.
  type Props = {
    recipe: Recipe;
    /** Portions affichées (gardées par la page : le mode cuisine les reprend). */
    servings: number | null;
    photoUrl: string | null;
    phone?: boolean;
    canEdit: boolean;
    canRemove: boolean;
    addedBy: string | null;
    onEdit: () => void;
    onRemove: () => void;
    /** Relire la page d'origine (les parties que notre version n'a pas modifiées en sont reprises). */
    onReread?: () => void;
    rereading?: boolean;
    onCook?: () => void;
    /** Lancer un minuteur depuis une étape (tablette). */
    onTimer?: (seconds: number, step: ShownStep) => void;
  };
  let { recipe, servings = $bindable(), photoUrl, phone = false, canEdit, canRemove, addedBy, onEdit, onRemove, onReread, rereading = false, onCook, onTimer }: Props = $props();

  let showSource = $state(false);
  let confirmRemove = $state(false);

  const content: RecipeContent = $derived(showSource && recipe.source?.content ? recipe.source.content : recipe.ours);
  const shownServings = $derived(showSource ? content.servings : servings);
  const ingredients = $derived(shownIngredients(content, shownServings));
  const steps = $derived(groupBySection(shownSteps(content)));
  const times = $derived(
    [
      content.prepMinutes ? `Préparation ${formatMinutes(content.prepMinutes)}` : null,
      content.cookMinutes ? `Cuisson ${formatMinutes(content.cookMinutes)}` : null,
      content.totalMinutes ? `Total ${formatMinutes(content.totalMinutes)}` : null,
    ].filter(Boolean),
  );
  /** Notre version sans étapes ou sans ingrédients : « Relire la page » se propose aussi sur la fiche. */
  const incomplete = $derived(recipe.ours.steps.length === 0 || recipe.ours.ingredients.length === 0);
  const importedOn =$derived(recipe.source ? new Date(recipe.source.importedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null);
</script>

<div class="view" class:phone>
  <section class="side card">
    {#if photoUrl && !showSource}
      <img class="photo" src={photoUrl} alt="" />
    {/if}
    <div class="meta">
      {#if content.appliance === 'cookeo'}<span class="chip cookeo">Cookeo</span>{/if}
      {#each times as time (time)}<span class="chip">{time}</span>{/each}
    </div>

    {#if showSource}
      <p class="servings-fixed">{servingsText(content.servings, content.servingsUnit) ?? 'Portions non précisées'}</p>
    {:else if servings !== null}
      <div class="stepper" role="group" aria-label="Portions">
        <button type="button" aria-label="Une portion de moins" disabled={servings <= 1} onclick={() => (servings = Math.max(1, (servings ?? 1) - 1))}><Icon name="minus" size={26} /></button>
        <span class="count">{servingsText(servings, content.servingsUnit)}</span>
        <button type="button" aria-label="Une portion de plus" disabled={servings >= 100} onclick={() => (servings = Math.min(100, (servings ?? 1) + 1))}><Icon name="plus" size={26} /></button>
      </div>
      {#if servings !== recipe.ours.servings}
        <p class="hint">Quantités recalculées (notre version : {servingsText(recipe.ours.servings, content.servingsUnit)})</p>
      {/if}
    {/if}

    <h2 class="card-label">Ingrédients</h2>
    {#each ingredients as group, g (g)}
      {#if group.section}<h3 class="section">{group.section}</h3>{/if}
      <ul class="ingredients">
        {#each group.items as line (line.id)}
          <li class:optional={line.optional}>{line.text}{#if line.optional}<span class="muted"> (facultatif)</span>{/if}</li>
        {/each}
      </ul>
    {:else}
      <p class="muted">Aucun ingrédient.</p>
    {/each}
  </section>

  <section class="main card">
    <h2 class="card-label">Étapes</h2>
    {#each steps as group, g (g)}
      {#if group.section}<h3 class="section">{group.section}</h3>{/if}
      <ol class="steps">
        {#each group.items as step (step.id)}
          <li>
            <span class="number">{step.number}</span>
            <div class="step-body">
              <p>{step.text}</p>
              {#if step.mode || (onTimer && !showSource && step.durations.length)}
                <div class="step-tools">
                  {#if step.mode}<span class="chip cookeo">{step.mode}</span>{/if}
                  {#if onTimer && !showSource}
                    {#each step.durations as d (d.text)}
                      <button type="button" class="chip timer" onclick={() => onTimer(d.seconds, step)}><Icon name="timer" size={20} /> {durationText(d.seconds)}</button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="muted">Aucune étape.</p>
    {/each}

    {#if !showSource && recipe.ours.tips}
      <h2 class="card-label">Nos astuces</h2>
      <p class="tips">{recipe.ours.tips}</p>
    {/if}

    <p class="origin muted">
      {#if recipe.source}
        {showSource ? 'Telle que lue' : 'D’après'} {recipe.source.site}{#if importedOn}, le {importedOn}{/if}{#if addedBy}{` · ajoutée par ${addedBy}`}{/if}
      {:else}
        Saisie à la main{#if addedBy} par {addedBy}{/if}
      {/if}
    </p>

    <div class="actions">
      {#if onCook && !showSource}
        <button type="button" class="btn primary" onclick={onCook}><Icon name="chef" size={24} /> Mode cuisine</button>
      {/if}
      {#if canEdit && !showSource}
        <button type="button" class="btn" onclick={onEdit}><Icon name="pencil" size={22} /> Modifier</button>
      {/if}
      {#if recipe.source?.content}
        <button type="button" class="btn" aria-pressed={showSource} onclick={() => (showSource = !showSource)}>
          <Icon name="book" size={22} /> {showSource ? 'Notre version' : 'Voir la source'}
        </button>
      {/if}
      {#if recipe.source && canEdit && onReread && (showSource || !recipe.source.content || incomplete)}
        <button type="button" class="btn" disabled={rereading} onclick={onReread}><Icon name="refresh" size={22} /> {rereading ? 'Lecture…' : 'Relire la page'}</button>
      {/if}
      {#if recipe.source && (showSource || !recipe.source.content)}
        <a class="btn" href={recipe.source.url} target="_blank" rel="noopener noreferrer"><Icon name="link" size={22} /> Ouvrir la page</a>
      {/if}
      {#if canRemove && !showSource}
        {#if confirmRemove}
          <button type="button" class="btn danger" onclick={onRemove}>Retirer du carnet ?</button>
          <button type="button" class="btn" onclick={() => (confirmRemove = false)}>Garder</button>
        {:else}
          <button type="button" class="btn" aria-label="Retirer du carnet" onclick={() => (confirmRemove = true)}><Icon name="trash" size={22} /></button>
        {/if}
      {/if}
    </div>
  </section>
</div>

<style>
  .view {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
    gap: var(--space-3);
    min-height: 0;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow-y: auto;
  }

  .photo {
    width: 100%;
    max-height: 180px;
    flex: none;
    border-radius: var(--radius-md);
    object-fit: cover;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 14px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1rem;
  }

  .chip.cookeo {
    background: var(--warn-bg);
    color: var(--sun);
    font-weight: 600;
  }

  .chip.timer {
    min-height: 44px;
    background: var(--rain-bg);
    color: var(--rain-soft);
    font-weight: 600;
    cursor: pointer;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .stepper button {
    display: grid;
    width: 56px;
    height: 56px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
    cursor: pointer;
  }

  .stepper button:disabled {
    opacity: 0.4;
  }

  .count {
    font-size: var(--text-title);
    font-weight: 600;
  }

  .servings-fixed {
    margin: 0;
    font-size: var(--text-title);
    font-weight: 600;
  }

  .hint {
    margin: 0;
    color: var(--rain-soft);
    font-size: 1rem;
  }

  .section {
    margin: var(--space-1) 0 0;
    font-size: var(--text-body);
    color: var(--fg-soft);
  }

  .ingredients {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-body);
  }

  .ingredients li {
    padding-bottom: 10px;
    border-bottom: 1px solid var(--surface-2);
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .steps li {
    display: flex;
    gap: var(--space-2);
  }

  .number {
    display: grid;
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 50%;
    background: var(--surface-2);
    font-weight: 700;
  }

  .step-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .step-body p,
  .tips {
    margin: 0;
    font-size: var(--text-body);
    line-height: 1.45;
    white-space: pre-line;
  }

  .step-tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .muted {
    color: var(--fg-muted);
  }

  .origin {
    margin: var(--space-1) 0 0;
    font-size: 1rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: auto;
    padding-top: var(--space-2);
  }

  a.btn {
    text-decoration: none;
  }

  .btn.danger {
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  /* Sur le téléphone, la page défile d'un bloc : la grille garde sa hauteur, les cartes ne défilent pas. */
  .phone {
    flex: none;
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .phone .card {
    padding: 16px;
    border-radius: 20px;
    overflow: visible;
  }

  .phone .ingredients,
  .phone .step-body p,
  .phone .tips {
    font-size: 1.1rem;
  }

  .phone .count {
    font-size: 1.25rem;
  }
</style>
