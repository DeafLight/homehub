<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { FAMILY_ID } from '../../../shared/types.ts';
  import AddForm, { type AddInput } from '../components/AddForm.svelte';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import PhonesPanel from '../components/PhonesPanel.svelte';
  import ShoppingPanel from '../components/ShoppingPanel.svelte';
  import TasksPanel from '../components/TasksPanel.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { createListsState } from '../lib/lists-state.svelte.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import type { PageRoute } from '../lib/route.ts';

  const LISTS_REFRESH_MS = 10_000;

  // Courses et tâches de la famille sur la tablette, ouvertes depuis un dashboard ou l'accueil : ce qui est coché ou
  // ajouté l'est au nom du profil d'origine. L'onglet « Téléphones » relie les téléphones de la famille.
  type Props = { back: PageRoute };
  let { back }: Props = $props();

  const { api, profiles, clock } = getAppContext();
  const origin = $derived(back.name === 'dashboard' ? back.ownerId : null);
  const lists = createListsState(api, () => origin, LISTS_REFRESH_MS);
  const me = createResource(() => api.me(), 60_000);
  onDestroy(() => {
    lists.destroy();
    me.destroy();
  });

  /** Écriture réservée à la tablette (et aux téléphones reliés) : ailleurs, les listes sont en lecture seule. */
  const readOnly = $derived(me.data !== null && !me.data.kiosk && !me.data.device);

  let view = $state<'lists' | 'phones'>('lists');
  let filter = $state<string | null>(untrack(() => (origin !== FAMILY_ID ? origin : null)));
  let adding = $state(false);

  async function add(input: AddInput) {
    if (input.kind === 'shopping') await lists.addShopping(input.label);
    else await lists.addTask({ label: input.label, ownerId: input.ownerId, due: input.due, repeat: input.repeat });
    adding = false;
  }
</script>

<div class="lists-page">
  <header>
    <BackButton {back} />
    <h1>Listes</h1>
    {#if me.data?.kiosk}
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'lists'} class:on={view === 'lists'} onclick={() => (view = 'lists')}>
          <Icon name="list" size={24} /> Listes
        </button>
        <button type="button" role="tab" aria-selected={view === 'phones'} class:on={view === 'phones'} onclick={() => (view = 'phones')}>
          <Icon name="phone" size={24} /> Téléphones
        </button>
      </div>
    {:else if readOnly}
      <span class="muted readonly">Lecture seule sur cet appareil</span>
    {/if}
  </header>

  {#if lists.actionError}<p class="error">{lists.actionError}</p>{/if}

  {#if view === 'phones'}
    <PhonesPanel />
  {:else if lists.data}
    {@const data = lists.data}
    <div class="columns">
      <section class="card">
        <h2><Icon name="cart" size={28} /> Courses</h2>
        <div class="scroll">
          <ShoppingPanel
            items={data.shopping}
            frequent={data.frequent}
            {readOnly}
            onAdd={lists.addShopping}
            onToggle={lists.setShoppingDone}
            onRemove={lists.removeShopping}
            onClear={lists.clearShopping}
          />
        </div>
      </section>

      <section class="card">
        <h2>
          <Icon name="check" size={28} /> Tâches
          {#if !readOnly}
            <button type="button" class="add" onclick={() => (adding = true)}><Icon name="plus" size={24} strokeWidth={2.4} /> Tâche</button>
          {/if}
        </h2>
        <div class="scroll">
          <TasksPanel
            tasks={data.tasks}
            {profiles}
            now={clock.now}
            {filter}
            {readOnly}
            onFilter={(id) => (filter = id)}
            onToggle={lists.setTaskDone}
            onRemove={lists.removeTask}
          />
        </div>
      </section>
    </div>
  {:else if lists.error}
    <p class="muted">Impossible de charger les listes : {lists.error}</p>
  {/if}
</div>

{#if adding}
  <div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (adding = false)}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Ajouter">
      <AddForm
        ownerId={filter ?? origin ?? profiles[0].id}
        {profiles}
        now={clock.now}
        onSubmit={add}
        onCancel={() => (adding = false)}
      />
    </div>
  </div>
{/if}

<style>
  .lists-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 28px 40px 36px;
    box-sizing: border-box;
  }

  header {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  h1 {
    margin: 0;
    font-size: 2.5rem;
    font-weight: 600;
  }

  .tabs {
    display: flex;
    gap: 6px;
    margin-left: auto;
    padding: 5px;
    border-radius: 999px;
    background: var(--surface);
  }

  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 0 24px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 600;
  }

  .tabs button.on {
    background: var(--surface-2);
    color: var(--fg);
  }

  .readonly {
    margin-left: auto;
  }

  .muted {
    font-size: 1.2rem;
    color: var(--fg-muted);
  }

  .error {
    margin: 0;
    font-size: 1.1rem;
    color: var(--danger-fg);
  }

  .columns {
    display: grid;
    flex: 1;
    grid-template-columns: 1fr 1.25fr;
    gap: 24px;
    min-height: 0;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
    padding: 24px 28px;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .add {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    margin-left: auto;
    padding: 0 20px 0 14px;
    border: 0;
    border-radius: 999px;
    background: var(--rain);
    color: var(--bg);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
  }

  .scroll {
    min-height: 0;
    overflow-y: auto;
  }

  .overlay {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 60%);
  }

  .dialog {
    width: min(620px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    box-sizing: border-box;
    padding: 28px;
    border-radius: var(--radius-xl);
    background: var(--surface);
    overflow-y: auto;
  }
</style>
