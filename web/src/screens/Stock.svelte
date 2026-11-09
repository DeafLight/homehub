<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Container, Product, StockEntry, StockMovementResult } from '../../../shared/types.ts';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import ContainerLabel from '../components/stock/ContainerLabel.svelte';
  import Modal from '../components/stock/Modal.svelte';
  import ProductSheet from '../components/stock/ProductSheet.svelte';
  import ShopPrompt from '../components/stock/ShopPrompt.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { PHONE_SCAN_PATH, type PageRoute, detailPath, phonePath } from '../lib/route.ts';
  import { lastMarksLine, productDetail } from '../lib/stock.ts';

  // Stock de la maison (tablette ; depuis Listes ou le scanner) : ce qu'on a, ce qui est épuisé, les contenants et
  // leur étiquette, et le réglage de la liste de courses. Les quantités se corrigent ici à la main (inventaire).
  // Sur le téléphone (`back` : null), pour voir au magasin ce qu'il reste : les produits, sans date ni auteur (dans leur
  // fiche), et les contenants en lecture.
  type Props = { back: PageRoute | null };
  let { back }: Props = $props();

  const { api, clock, config, navigate, router } = getAppContext();
  /** Sur le téléphone (pas de page de la tablette où revenir) ; fixé à l'ouverture. */
  const phone = untrack(() => back === null);
  const nameOf = (ownerId: string | null) => (ownerId ? (config.members.find((m) => m.id === ownerId)?.name ?? null) : null);
  const stock = createResource(() => api.stock(), 60_000);
  const me = createResource(() => api.me(), 60_000);
  onDestroy(() => {
    stock.destroy();
    me.destroy();
  });

  const readOnly = $derived(me.data !== null && !me.data.kiosk && !me.data.device);

  type Filter = 'in' | 'out' | 'all';
  let filter = $state<Filter>('in');
  let search = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let newContainer = $state('');
  type Dialog = { kind: 'sheet'; product: Product; quantity: number } | { kind: 'shop'; code: string; label: string } | { kind: 'label'; container: Container; name: string };
  let dialog = $state<Dialog | null>(null);

  const items = $derived(stock.data?.items ?? []);
  const inStock = $derived(items.filter((i) => i.quantity > 0));
  const empty = $derived(items.filter((i) => i.quantity === 0));
  const shown = $derived.by(() => {
    const base = filter === 'in' ? inStock : filter === 'out' ? empty : items;
    const query = search.trim().toLocaleLowerCase('fr');
    return query ? base.filter((i) => `${i.product.current.name} ${i.product.current.brand ?? ''}`.toLocaleLowerCase('fr').includes(query)) : base;
  });

  async function run(action: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await action();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
      await stock.refresh();
    }
  }

  function proposeShopping(result: StockMovementResult) {
    if (result.shopping === 'propose' && result.product && result.shoppingLabel) dialog = { kind: 'shop', code: result.product.code, label: result.shoppingLabel };
  }

  const plus = (entry: StockEntry) => run(async () => void (await api.stockIn(entry.product.code)));
  const minus = (entry: StockEntry) => run(async () => proposeShopping(await api.stockOut(entry.product.code)));
  const exhaust = (entry: StockEntry) => run(async () => proposeShopping(await api.stockOut(entry.product.code, { all: true })));
  const emptyContainer = (container: Container) => run(async () => proposeShopping(await api.emptyContainer(container.id)));
  const setAutoShop = (autoShop: boolean) => run(async () => void (await api.saveStockSettings({ autoShop })));

  function addContainer(event: SubmitEvent) {
    event.preventDefault();
    const name = newContainer.trim();
    if (!name) return;
    void run(async () => {
      const container = await api.addContainer(name);
      newContainer = '';
      dialog = { kind: 'label', container, name: container.name };
    });
  }
</script>

<div class="stock-page" class:phone>
  <header>
    {#if back}
      <BackButton {back} />
    {:else}
      <button type="button" class="btn" onclick={() => navigate(phonePath('shopping'))}><Icon name="back" size={24} /> Courses</button>
    {/if}
    <h1>Stock</h1>
    <input class="search" type="search" bind:value={search} placeholder="Chercher un produit" aria-label="Chercher un produit" />
    {#if readOnly}
      <span class="muted">Lecture seule sur cet appareil</span>
    {:else}
      <button type="button" class="btn primary" aria-label="Scanner" onclick={() => navigate(phone ? PHONE_SCAN_PATH : detailPath('scan', router.route))}><Icon name="barcode" size={24} />{#if !phone}Scanner{/if}</button>
    {/if}
  </header>

  {#if error}<p class="error">{error}</p>{/if}

  {#if stock.data}
    {@const data = stock.data}
    <div class="columns">
      <section class="card products">
        <div class="filters" role="tablist" aria-label="Produits affichés">
          <button type="button" role="tab" aria-selected={filter === 'in'} class:on={filter === 'in'} onclick={() => (filter = 'in')}>En stock · {inStock.length}</button>
          <button type="button" role="tab" aria-selected={filter === 'out'} class:on={filter === 'out'} onclick={() => (filter = 'out')}>Épuisés · {empty.length}</button>
          <button type="button" role="tab" aria-selected={filter === 'all'} class:on={filter === 'all'} onclick={() => (filter = 'all')}>Tout · {items.length}</button>
        </div>
        <ul class="list">
          {#each shown as entry (entry.product.code)}
            {@const product = entry.product}
            {@const marks = phone ? '' : lastMarksLine(entry, clock.now, nameOf)}
            <li class:empty={entry.quantity === 0}>
              <button type="button" class="name" onclick={() => (dialog = { kind: 'sheet', product, quantity: entry.quantity })}>
                <strong>{product.current.name}{#if product.conflict}<span class="flag" title="La base dit autre chose">!</span>{/if}</strong>
                <span>{[productDetail(product.current), product.current.category].filter(Boolean).join(' · ') || 'Toucher pour compléter la fiche'}</span>
                {#if marks}<span class="marks">{marks}</span>{/if}
              </button>
              {#if !readOnly}
                <span class="qty">
                  <button type="button" class="round" aria-label="Un de moins" disabled={busy || entry.quantity === 0} onclick={() => minus(entry)}><Icon name="minus" size={22} /></button>
                  <span class="count">{entry.quantity}</span>
                  <button type="button" class="round" aria-label="Un de plus" disabled={busy} onclick={() => plus(entry)}><Icon name="plus" size={22} /></button>
                </span>
                {#if entry.quantity > 1}
                  <button type="button" class="btn small" disabled={busy} onclick={() => exhaust(entry)}>Épuisé</button>
                {/if}
              {:else}
                <span class="count">{entry.quantity}</span>
              {/if}
            </li>
          {:else}
            <li class="none">
              {#if items.length === 0}
                Rien pour l’instant : scanne les courses en les rangeant (« Ranger les courses »).
              {:else if search}
                Aucun produit ne correspond.
              {:else}
                Aucun produit ici.
              {/if}
            </li>
          {/each}
        </ul>
      </section>

      <div class="side">
        <section class="card">
          <h2 class="card-label">Contenants de la maison</h2>
          {#if !phone}<p class="muted small">Bidon de lessive, bocal à farine… : on y transvase les recharges. Leur étiquette se scanne pour les déclarer vides.</p>{/if}
          <ul class="containers">
            {#each data.containers as container (container.id)}
              <li>
                <Icon name="jar" size={26} color={container.full ? 'var(--ok)' : 'var(--fg-muted)'} />
                <span class="container-text">
                  <strong>{container.name}</strong>
                  <span>{container.full ? (container.productName ?? 'Plein') : container.productName ? `Vide (${container.productName})` : 'Vide'}</span>
                </span>
                {#if !phone}
                  {#if !readOnly && container.full}
                    <button type="button" class="btn small" disabled={busy} onclick={() => emptyContainer(container)}>Vide</button>
                  {/if}
                  <button type="button" class="btn small" aria-label="Étiquette de {container.name}" onclick={() => (dialog = { kind: 'label', container, name: container.name })}>
                    <Icon name="barcode" size={20} />
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
          {#if !readOnly && !phone}
            <form class="add" onsubmit={addContainer}>
              <input bind:value={newContainer} maxlength="60" placeholder="Nouveau contenant" aria-label="Nouveau contenant" />
              <button type="submit" class="btn small" disabled={busy || !newContainer.trim()}><Icon name="plus" size={20} /> Ajouter</button>
            </form>
          {/if}
        </section>

        {#if !phone}<section class="card">
          <h2 class="card-label">Produit épuisé</h2>
          <div class="chips">
            <button type="button" class:on={!data.settings.autoShop} disabled={busy || readOnly} onclick={() => setAutoShop(false)}>Demander avant d’ajouter aux courses</button>
            <button type="button" class:on={data.settings.autoShop} disabled={busy || readOnly} onclick={() => setAutoShop(true)}>L’ajouter d’office aux courses</button>
          </div>
          <p class="muted small">Chaque produit peut avoir son propre réglage (toucher son nom).</p>
        </section>{/if}
      </div>
    </div>
  {:else if stock.error}
    <p class="muted">Impossible de charger le stock : {stock.error}</p>
  {/if}
</div>

{#if dialog?.kind === 'sheet'}
  {@const d = dialog}
  <Modal label="Fiche du produit" onClose={() => (dialog = null)} wide>
    <ProductSheet
      product={d.product}
      quantity={d.quantity}
      containers={stock.data?.containers ?? []}
      onChange={(product) => {
        dialog = { ...d, product };
        void stock.refresh();
      }}
      onClose={() => (dialog = null)}
    />
  </Modal>
{:else if dialog?.kind === 'shop'}
  {@const d = dialog}
  <Modal label="Liste de courses" locked>
    <ShopPrompt code={d.code} label={d.label} onDone={() => (dialog = null)} />
  </Modal>
{:else if dialog?.kind === 'label'}
  {@const d = dialog}
  <Modal label="Étiquette du contenant" onClose={() => (dialog = null)}>
    <div class="printable"><ContainerLabel name={d.container.name} code={d.container.code} /></div>
    <p class="muted small">Imprime l’étiquette et colle-la sur le contenant : scannée en mode « Jeté / épuisé », elle le déclare vide.</p>
    {#if !readOnly}
      <form
        class="add"
        onsubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const renamed = await api.renameContainer(d.container.id, d.name.trim());
            dialog = { kind: 'label', container: renamed, name: renamed.name };
          });
        }}
      >
        <input bind:value={d.name} maxlength="60" aria-label="Nom du contenant" />
        <button type="submit" class="btn small" disabled={busy || !d.name.trim() || d.name.trim() === d.container.name}>Renommer</button>
      </form>
    {/if}
    <div class="dialog-actions">
      <button type="button" class="btn primary" onclick={() => window.print()}><Icon name="printer" size={22} /> Imprimer</button>
      {#if !readOnly}
        <button
          type="button"
          class="btn"
          disabled={busy}
          onclick={() => run(async () => { await api.removeContainer(d.container.id); dialog = null; })}
        >
          <Icon name="trash" size={22} /> Retirer
        </button>
      {/if}
      <button type="button" class="btn" onclick={() => (dialog = null)}>Fermer</button>
    </div>
  </Modal>
{/if}

<style>
  .stock-page {
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

  .muted {
    color: var(--fg-muted);
  }

  .small {
    margin: 0;
    font-size: var(--text-small);
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }

  .columns {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
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
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
    overflow-y: auto;
  }

  .filters,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .filters button,
  .chips button {
    min-height: 48px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-small);
  }

  .filters button.on,
  .chips button.on {
    background: var(--rain);
    color: var(--bg);
    font-weight: 600;
  }

  .list,
  .containers {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /* flex: none : dans la liste qui défile, une ligne garde sa hauteur au lieu d'être écrasée et de laisser déborder son texte. */
  .list li {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    min-height: 72px;
    border-bottom: 1px solid var(--surface-2);
  }

  .list li.empty .name strong {
    color: var(--fg-muted);
  }

  .list li.none {
    min-height: 0;
    padding: var(--space-2) 0;
    border: 0;
    color: var(--fg-muted);
  }

  .name {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 8px 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }

  .name strong {
    overflow: hidden;
    font-size: var(--text-body);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .name span {
    overflow: hidden;
    color: var(--fg-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Dernière entrée et sortie : sur deux lignes s'il le faut, jamais coupée. */
  .name .marks {
    font-size: var(--text-small);
    white-space: normal;
  }

  .flag {
    display: inline-grid;
    width: 22px;
    height: 22px;
    margin-left: 8px;
    place-items: center;
    border-radius: 50%;
    background: var(--warn);
    color: var(--bg);
    font-size: 0.9rem;
  }

  .qty {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .round {
    display: grid;
    width: 48px;
    height: 48px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
  }

  .round:disabled {
    opacity: 0.4;
  }

  .count {
    min-width: 2ch;
    font-size: var(--text-title);
    font-weight: 600;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .containers li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 64px;
    border-bottom: 1px solid var(--surface-2);
  }

  .container-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .container-text span {
    color: var(--fg-muted);
  }

  .add {
    display: flex;
    gap: var(--space-1);
  }

  .add input {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0 16px;
    border: 2px solid var(--surface-2);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, var(--text-small));
  }

  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  /* Téléphone : une seule colonne, toute la page défile ; les boutons d'un produit sous son nom. */
  .stock-page.phone {
    height: 100dvh;
    max-width: 640px;
    margin: 0 auto;
    padding: calc(10px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom));
    overflow-y: auto;
  }

  .phone header {
    flex-wrap: wrap;
  }

  .phone h1 {
    font-size: 1.6rem;
  }

  .phone header .btn.primary {
    margin-left: auto;
  }

  .phone .card {
    padding: 12px;
  }

  .phone .filters button {
    min-height: 44px;
    padding: 0 12px;
  }

  .phone .search {
    flex: 1 1 100%;
    max-width: none;
    order: 1;
    margin-left: 0;
  }

  .phone .columns {
    display: flex;
    flex: none;
    flex-direction: column;
  }

  .phone .list,
  .phone .side {
    flex: none;
    overflow: visible;
  }

  /* Une ligne compacte, pour voir plusieurs produits d'un coup : le texte à gauche, les boutons empilés à droite. */
  .phone .list li:not(.none) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-1);
    row-gap: 6px;
    padding: 8px 0;
  }

  .phone .name {
    grid-row: 1 / span 2;
    padding: 0;
  }

  .phone .name strong,
  .phone .name span {
    white-space: normal;
  }

  .phone .list li > .btn {
    justify-self: end;
  }

  .phone .list li > .count {
    grid-row: 1 / span 2;
  }

  .phone .round {
    width: 40px;
    height: 40px;
  }

  /* Impression : l'étiquette seule. */
  @media print {
    :global(body *) {
      visibility: hidden;
    }

    .printable,
    .printable :global(*) {
      visibility: visible;
    }

    .printable {
      position: fixed;
      top: 0;
      left: 0;
      width: 70mm;
    }
  }
</style>
