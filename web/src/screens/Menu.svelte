<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { addWeeks, type MenuStockProduct, type MenuViewEntry, type PlanLine, type StockLink } from '../../../shared/menu.ts';
  import { FAMILY_ID } from '../../../shared/types.ts';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import MenuDays from '../components/menu/MenuDays.svelte';
  import MenuEntryForm from '../components/menu/MenuEntryForm.svelte';
  import MenuNeeds from '../components/menu/MenuNeeds.svelte';
  import PantryForm from '../components/menu/PantryForm.svelte';
  import StockLinks from '../components/menu/StockLinks.svelte';
  import Modal from '../components/stock/Modal.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { entriesByDay, weekLabel, weekRange } from '../lib/menu.ts';
  import { loadPairing } from '../lib/phone.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { type PageRoute, detailPath, phonePath, phoneRecipePath, recipePath } from '../lib/route.ts';

  const MENU_REFRESH_MS = 30_000;

  // Menu de la semaine, sur la tablette (depuis Recettes ou Listes) et sur le téléphone (`back` : null) : les
  // recettes du carnet choisies pour la semaine, chacune pour un nombre de personnes et, si on veut, un jour ; à côté,
  // les courses qui en découlent (par rayon, avec ce qu'on a déjà), qui rejoignent la liste de courses. Semaines
  // précédentes consultables. Modifier : un parent (reconnu à la tablette, ou son téléphone). Placards et liens
  // entre le stock et les ingrédients se règlent ici aussi.
  type Props = { back: PageRoute | null };
  let { back }: Props = $props();

  const { api, actor, config, navigate, router } = getAppContext();
  const phone = untrack(() => back === null);
  const pairing = phone ? loadPairing() : null;
  const member = config.members.find((m) => m.id === pairing?.ownerId);

  let week = $state<string | null>(null);
  const view = createResource(() => api.menu(week ?? undefined), MENU_REFRESH_MS);
  const recipes = createResource(() => api.recipes(), 5 * 60_000);
  const me = createResource(() => api.me(), 60_000);
  onDestroy(() => {
    view.destroy();
    recipes.destroy();
    me.destroy();
  });

  /** Tablette : la personne reconnue est vérifiée à chaque geste ; téléphone : seulement un parent ; ailleurs, rien. */
  const canEdit = $derived(phone ? member?.parent === true : !(me.data !== null && !me.data.kiosk && !me.data.device));
  const editable = $derived((view.data?.editable ?? false) && canEdit);

  let busy = $state(false);
  let error = $state<string | null>(null);
  type Dialog = { kind: 'add' } | { kind: 'entry'; entry: MenuViewEntry } | { kind: 'pantry' } | { kind: 'stock' };
  let dialog = $state<Dialog | null>(null);

  function goWeek(offset: number) {
    if (!view.data) return;
    week = addWeeks(view.data.week, offset);
    void view.refresh();
  }

  /** Une modification : la personne vérifiée sur la tablette, bouton occupé, erreur affichée, puis le menu relu. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    error = null;
    if (!phone && !(await actor.allow(FAMILY_ID))) return false;
    busy = true;
    try {
      await action();
      return true;
    } catch (err) {
      error = (err as Error).message;
      return false;
    } finally {
      busy = false;
      await view.refresh();
    }
  }

  async function openAdd() {
    if (phone || (await actor.allow(FAMILY_ID))) dialog = { kind: 'add' };
  }

  async function save(choice: { recipeId: string; people: number; day: string | null }) {
    const current = dialog;
    const data = view.data;
    if (!data || !current) return;
    const ok = await run(() =>
      current.kind === 'entry'
        ? api.updateMenuEntry(current.entry.id, { people: choice.people, day: choice.day })
        : api.addMenuEntry(data.week, choice.recipeId, choice.people, choice.day),
    );
    if (ok) dialog = null;
  }

  async function remove(entry: MenuViewEntry) {
    if (await run(() => api.removeMenuEntry(entry.id))) dialog = null;
  }

  const setPeople = (entry: MenuViewEntry, people: number) => run(() => api.updateMenuEntry(entry.id, { people }));
  const setHave = (line: PlanLine, have: boolean) => run(() => api.setMenuHave(view.data!.week, line.key, have));
  const link = (product: MenuStockProduct, value: StockLink | null) => run(() => api.setStockLink(product.code, value));
  const forget = (product: MenuStockProduct) => run(() => api.forgetStockLink(product.code));
  async function savePantry(names: string[]) {
    if (await run(() => api.setPantry(names))) dialog = null;
  }

  const openRecipe = (entry: MenuViewEntry) => navigate(phone ? phoneRecipePath(entry.recipeId) : recipePath(entry.recipeId));
  const proposals = $derived(view.data?.stock.filter((p) => !p.decided).length ?? 0);
</script>

<div class="menu-page" class:phone>
  <header>
    {#if back}
      <BackButton {back} />
    {:else}
      <button type="button" class="btn" onclick={() => navigate(phonePath('recipes'))}><Icon name="back" size={24} /> Recettes</button>
    {/if}
    <div class="titles">
      <h1>{phone ? 'Menu' : 'Menu de la semaine'}</h1>
      {#if view.data}<span class="subtitle">{weekRange(view.data.week)}</span>{/if}
    </div>
    {#if view.data}
      <div class="weeks">
        <button type="button" class="round" aria-label="Semaine précédente" onclick={() => goWeek(-1)}><Icon name="chevron" size={24} /></button>
        <span class="week-label">{weekLabel(view.data.week, view.data.current)}</span>
        <button type="button" class="round next" aria-label="Semaine suivante" onclick={() => goWeek(1)}><Icon name="chevron" size={24} /></button>
      </div>
    {/if}
    {#if !phone}
      <button type="button" class="btn" onclick={() => navigate(detailPath('lists', router.route))}><Icon name="cart" size={24} /> Courses</button>
    {/if}
  </header>

  {#if error}<p class="error">{error}</p>{/if}

  {#if view.data}
    {@const data = view.data}
    <div class="columns">
      <section class="card">
        <div class="head">
          <h2 class="card-label">Recettes</h2>
          {#if editable}<button type="button" class="btn primary small" onclick={openAdd}><Icon name="plus" size={22} /> Recette</button>{/if}
        </div>
        <div class="scroll">
          {#if data.entries.length === 0 && !editable}
            <p class="muted">{data.editable ? 'Aucune recette au menu.' : 'Pas de menu cette semaine-là.'}</p>
          {:else}
            <MenuDays groups={entriesByDay(data.week, data.entries, !phone)} {editable} {busy} onPeople={setPeople} onOpen={(entry) => (dialog = { kind: 'entry', entry })} />
          {/if}
        </div>
      </section>

      <section class="card">
        <div class="head">
          <h2 class="card-label">Courses du menu</h2>
          <!-- Produits du stock qui ressemblent à un ingrédient : à relier une fois (correspondance devinée). -->
          {#if data.editable}
            <button type="button" class="link" onclick={() => (dialog = { kind: 'stock' })}>
              <Icon name="box" size={20} /> {proposals > 0 ? `${proposals} à relier` : 'Stock'}
            </button>
          {/if}
        </div>
        <div class="scroll">
          <MenuNeeds
            plan={data.plan}
            {editable}
            empty={data.editable ? 'Ajoute des recettes : leurs ingrédients s’additionnent ici, puis rejoignent la liste de courses.' : 'Rien à acheter.'}
            {busy}
            onHave={setHave}
          />
        </div>
        <p class="pantry muted">
          Placards ignorés : {data.pantry.join(', ') || 'aucun'}
          {#if canEdit}· <button type="button" class="link inline" onclick={() => (dialog = { kind: 'pantry' })}>Modifier</button>{/if}
        </p>
      </section>
    </div>
  {:else if view.error}
    <p class="muted">Impossible de charger le menu : {view.error}</p>
  {/if}
</div>

{#if dialog && view.data}
  {@const data = view.data}
  {#if dialog.kind === 'add'}
    <Modal label="Ajouter au menu" onClose={() => (dialog = null)}>
      <MenuEntryForm week={data.week} recipes={recipes.data?.recipes ?? []} editable {busy} onSave={save} onCancel={() => (dialog = null)} />
    </Modal>
  {:else if dialog.kind === 'entry'}
    {@const entry = dialog.entry}
    <Modal label={entry.title} onClose={() => (dialog = null)}>
      <MenuEntryForm week={data.week} {entry} {editable} {busy} onSave={save} onRemove={() => remove(entry)} onOpenRecipe={() => openRecipe(entry)} onCancel={() => (dialog = null)} />
    </Modal>
  {:else if dialog.kind === 'pantry'}
    <Modal label="Placards" onClose={() => (dialog = null)}>
      <PantryForm names={data.pantry} {busy} onSave={savePantry} onCancel={() => (dialog = null)} />
    </Modal>
  {:else}
    <Modal label="Stock et ingrédients" wide onClose={() => (dialog = null)}>
      <StockLinks products={data.stock} ingredients={data.ingredients} editable={canEdit} {busy} onLink={link} onForget={forget} onClose={() => (dialog = null)} />
    </Modal>
  {/if}
{/if}

<style>
  .menu-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 100%;
    padding: var(--space-3) var(--space-4);
    box-sizing: border-box;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 72px;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-size: var(--text-heading);
    font-weight: 600;
  }

  .subtitle {
    font-size: var(--text-small);
    color: var(--fg-muted);
  }

  .weeks {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
  }

  .week-label {
    min-width: 170px;
    font-size: var(--text-body);
    font-weight: 600;
    text-align: center;
  }

  .round {
    display: grid;
    width: 52px;
    height: 52px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
    transform: rotate(180deg);
  }

  .round.next {
    transform: none;
  }

  .columns {
    display: grid;
    flex: 1;
    grid-template-columns: 1fr 1.2fr;
    gap: var(--space-2);
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
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
    min-height: 44px;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-small);
    font-weight: 600;
  }

  .link.inline {
    min-height: 36px;
    padding: 0 10px;
  }

  .pantry {
    margin: 0;
    padding-top: var(--space-1);
    border-top: 1px solid var(--surface-2);
  }

  .muted {
    color: var(--fg-muted);
    font-size: var(--text-small);
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }

  /* Téléphone : une colonne qui défile en entier, en-tête sur deux lignes. */
  .menu-page.phone {
    height: auto;
    min-height: 100%;
    padding: var(--space-2) 16px calc(var(--space-3) + env(safe-area-inset-bottom));
  }

  .phone header {
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
  }

  .phone .weeks {
    width: 100%;
    justify-content: space-between;
    margin-left: 0;
  }

  .phone .columns {
    grid-template-columns: 1fr;
  }

  .phone .card {
    padding: var(--space-2);
  }

  .phone .scroll {
    overflow: visible;
  }
</style>
