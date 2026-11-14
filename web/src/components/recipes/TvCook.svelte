<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ScreenCookTarget } from '../../../../shared/screen-cook.ts';
  import { getAppContext } from '../../lib/context.ts';
  import { createResource } from '../../lib/resource.svelte.ts';
  import { cookingOn, launchLabel, pilotText } from '../../lib/screen-cook.ts';
  import Icon from '../Icon.svelte';

  // « Sur la télé », dans les actions de la fiche recette (tablette, téléphone) : lance le mode cuisine de la recette
  // sur une télé qui a l'appli HomeHub TV (étape en cours en grand, minuteurs de l'étape). Une fois lancé, la fiche
  // pilote la télé : étape précédente ou suivante, « Arrêter ». La télécommande de la télé fait de même (flèches, OK) ;
  // l'état est relu toutes les quelques secondes. Sans télé appairée, rien ne s'affiche.
  type Props = { recipeId: string; phone?: boolean };
  let { recipeId, phone = false }: Props = $props();

  const { api } = getAppContext();
  const targets = createResource<ScreenCookTarget[]>(() => api.screenCooks(), 4_000);
  onDestroy(() => targets.destroy());

  const list = $derived(targets.data ?? []);
  const active = $derived(cookingOn(list, recipeId));
  let busy = $state(false);
  let error = $state<string | null>(null);

  /** Appel puis relecture de l'état ; l'erreur du serveur (télé éteinte, appli fermée) s'affiche. */
  async function act(action: () => Promise<unknown>) {
    busy = true;
    error = null;
    try {
      await action();
      targets.set(await api.screenCooks());
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  const step = (delta: number) => {
    if (active?.cook) {
      const { id } = active;
      const index = active.cook.index + delta;
      void act(() => api.screenCookStep(id, index));
    }
  };
</script>

{#if active?.cook}
  <div class="pilot" class:phone role="group" aria-label="Mode cuisine sur la télé">
    <span class="state"><Icon name="tv" size={phone ? 20 : 24} /> {pilotText(active)}</span>
    <div class="buttons">
      <button type="button" class="btn" disabled={busy || active.cook.index === 0} onclick={() => step(-1)} aria-label="Étape précédente"><Icon name="back" size={24} /></button>
      <button type="button" class="btn primary" disabled={busy || active.cook.index >= active.cook.total - 1} onclick={() => step(1)}>Suivante <Icon name="chevron" size={24} /></button>
      <button type="button" class="btn" disabled={busy} onclick={() => act(() => api.stopScreenCook(active.id))}><Icon name="close" size={22} /> Arrêter</button>
    </div>
  </div>
{:else}
  {#each list as target (target.id)}
    <button type="button" class="btn" disabled={busy} onclick={() => act(() => api.startScreenCook(target.id, recipeId, 0))}>
      <Icon name="tv" size={22} /> {launchLabel(target, list.length)}
    </button>
  {/each}
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  .pilot {
    display: flex;
    flex-basis: 100%;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--rain-bg);
  }

  .state {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--rain-soft);
    font-weight: 600;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .pilot.phone {
    padding: 10px 12px;
  }

  .pilot.phone .buttons {
    width: 100%;
    flex-wrap: nowrap;
    gap: 8px;
  }

  .pilot.phone .btn {
    flex: 1;
    justify-content: center;
    min-height: 44px;
    padding: 0 10px;
    font-size: 1rem;
  }

  .pilot.phone .btn:first-child {
    flex: 0 0 auto;
  }

  .error {
    flex-basis: 100%;
    margin: 0;
    color: var(--danger-fg);
  }
</style>
