<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Recipe } from '../../../../shared/recipes.ts';
  import { createWakeLock } from '../../lib/wake-lock.ts';
  import { durationText, servingsText, shownIngredients, shownSteps, type ShownStep } from '../../lib/recipes.ts';
  import Icon from '../Icon.svelte';

  // Mode cuisine de la tablette : une étape à la fois, en grand, lisible de loin ; l'écran reste allumé (verrou
  // d'écran) ; une étape qui cite une durée lance le minuteur de la maison d'un toucher ; le mode Cookeo de l'étape
  // ressort. Les ingrédients s'ouvrent sur le côté, aux portions choisies sur la fiche.
  type Props = {
    recipe: Recipe;
    servings: number | null;
    onTimer: (seconds: number, step: ShownStep) => void;
    onExit: () => void;
  };
  let { recipe, servings, onTimer, onExit }: Props = $props();

  const steps = $derived(shownSteps(recipe.ours));
  const ingredients = $derived(shownIngredients(recipe.ours, servings));
  let index = $state(0);
  let showIngredients = $state(false);
  const step = $derived(steps[Math.min(index, steps.length - 1)]);
  const last = $derived(index >= steps.length - 1);

  const wakeLock = createWakeLock();
  onMount(() => wakeLock.acquire());
  onDestroy(() => wakeLock.release());

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowRight' && !last) index += 1;
    if (event.key === 'ArrowLeft' && index > 0) index -= 1;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="kitchen">
  <header>
    <button type="button" class="btn" onclick={onExit}><Icon name="back" size={26} /> Fiche</button>
    <div class="where">
      <span class="title">{recipe.ours.title}</span>
      {#if step?.section}<span class="muted"> · {step.section}</span>{/if}
    </div>
    <span class="muted">Étape {Math.min(index + 1, steps.length)} / {steps.length}</span>
    <button type="button" class="btn" aria-pressed={showIngredients} onclick={() => (showIngredients = !showIngredients)}><Icon name="list" size={24} /> Ingrédients</button>
  </header>

  <div class="body">
    <main>
      {#if step}
        <p class="step">{step.text}</p>
        <div class="tools">
          {#if step.mode}<span class="chip cookeo">Cookeo · {step.mode}</span>{/if}
          {#each step.durations as d (d.text)}
            <button type="button" class="btn primary big" onclick={() => onTimer(d.seconds, step)}><Icon name="timer" size={30} /> Lancer {durationText(d.seconds)}</button>
          {/each}
        </div>
      {:else}
        <p class="step muted">Cette recette n’a pas encore d’étapes.</p>
      {/if}
    </main>

    {#if showIngredients}
      <aside>
        <h2 class="card-label">Ingrédients{servings ? ` · ${servingsText(servings, recipe.ours.servingsUnit)}` : ''}</h2>
        {#each ingredients as group, g (g)}
          {#if group.section}<h3>{group.section}</h3>{/if}
          <ul>
            {#each group.items as line (line.id)}<li>{line.text}</li>{/each}
          </ul>
        {/each}
      </aside>
    {/if}
  </div>

  <footer>
    <button type="button" class="btn big" disabled={index === 0} onclick={() => (index -= 1)}><Icon name="back" size={30} /> Précédente</button>
    <div class="dots" aria-hidden="true">
      {#each steps as s, i (s.id)}<span class:on={i === index}></span>{/each}
    </div>
    {#if last}
      <button type="button" class="btn ok big" onclick={onExit}><Icon name="check" size={30} /> Terminé</button>
    {:else}
      <button type="button" class="btn primary big" onclick={() => (index += 1)}>Suivante <Icon name="chevron" size={30} /></button>
    {/if}
  </footer>
</div>

<style>
  .kitchen {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 100%;
    padding: var(--space-3) var(--space-6);
    box-sizing: border-box;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-body);
  }

  .where {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title {
    font-weight: 600;
  }

  .muted {
    color: var(--fg-muted);
  }

  .body {
    display: flex;
    flex: 1;
    gap: var(--space-3);
    min-height: 0;
  }

  main {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-4);
    border-radius: var(--radius-xl);
    background: var(--surface);
    overflow-y: auto;
  }

  .step {
    margin: 0;
    font-size: clamp(2rem, 3.4vw, 3rem);
    font-weight: 600;
    line-height: 1.3;
    white-space: pre-line;
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .chip {
    padding: 10px 22px;
    border-radius: 999px;
    font-size: var(--text-title);
    font-weight: 600;
  }

  .chip.cookeo {
    background: var(--warn-bg);
    color: var(--sun);
  }

  aside {
    width: 340px;
    flex-shrink: 0;
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow-y: auto;
  }

  aside h3 {
    margin: var(--space-2) 0 0;
    color: var(--fg-soft);
  }

  aside ul {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-body);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .big {
    min-height: 76px;
    padding: 0 34px;
    font-size: var(--text-title);
  }

  .dots {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }

  .dots span {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--surface-2);
  }

  .dots span.on {
    background: var(--rain);
  }
</style>
