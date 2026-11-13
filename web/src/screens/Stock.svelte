<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { localDay } from '../../../shared/dates.ts';
  import type { Container, LotView, Product, StockEntry, StockMovementResult } from '../../../shared/types.ts';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import ContainerLabelDialog from '../components/stock/ContainerLabelDialog.svelte';
  import ContainersList from '../components/stock/ContainersList.svelte';
  import DatePad from '../components/stock/DatePad.svelte';
  import ExpirySettingsDialog from '../components/stock/ExpirySettingsDialog.svelte';
  import LooseForm from '../components/stock/LooseForm.svelte';
  import Modal from '../components/stock/Modal.svelte';
  import ProductSheet from '../components/stock/ProductSheet.svelte';
  import ShopPrompt from '../components/stock/ShopPrompt.svelte';
  import StockList from '../components/stock/StockList.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { PHONE_SCAN_PATH, type PageRoute, detailPath, phonePath } from '../lib/route.ts';
  import { type StockFilter, thrownText } from '../lib/stock.ts';
  import { takeStockFilter } from '../lib/stock-opening.ts';

  // Stock de la maison (tablette ; depuis Listes ou le scanner) : ce qu'on a, ce qui est épuisé, les contenants et
  // leur étiquette, et le réglage de la liste de courses. Les quantités se corrigent ici à la main (inventaire), et
  // un produit sans code-barres (marché, vrac, fait maison) s'ajoute par son nom et sa quantité (aussi au téléphone).
  // Sur le téléphone (`back` : null), pour voir au magasin ce qu'il reste : les produits, sans date ni auteur (dans leur
  // fiche), et les contenants en lecture. Dates de péremption : filtre « À consommer », date d'un lot (pavé),
  // « Jeté » / « Encore bon », produits jetés périmés ce mois-ci, et (tablette) le réglage des seuils et des durées.
  // La page garde les données et les appels ; l'affichage est dans components/stock/ (StockList, ContainersList,
  // ContainerLabelDialog, DatePad, ExpirySettingsDialog).
  type Props = { back: PageRoute | null };
  let { back }: Props = $props();

  const { api, clock, config, navigate, router } = getAppContext();
  /** Sur le téléphone (pas de page de la tablette où revenir) ; fixé à l'ouverture. */
  const phone = untrack(() => back === null);
  const nameOf = (ownerId: string | null) => (ownerId ? (config.members.find((m) => m.id === ownerId)?.name ?? null) : null);
  const stock = createResource(() => api.stock(), 60_000);
  const expiring = createResource(() => api.expiring(), 60_000);
  const me = createResource(() => api.me(), 60_000);
  onDestroy(() => {
    stock.destroy();
    expiring.destroy();
    me.destroy();
  });
  const today = $derived(localDay(clock.now));

  const readOnly = $derived(me.data !== null && !me.data.kiosk && !me.data.device);

  let filter = $state<StockFilter>(takeStockFilter() ?? 'in');
  let search = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  type Dialog =
    | { kind: 'sheet'; product: Product; quantity: number }
    | { kind: 'shop'; code: string; label: string }
    | { kind: 'label'; container: Container }
    | { kind: 'loose' }
    | { kind: 'date'; entry: StockEntry; lot: LotView }
    | { kind: 'expiry' };
  let dialog = $state<Dialog | null>(null);

  /** Lance une modification (bouton occupé, erreur affichée), puis relit le stock ; vrai si elle a réussi. */
  async function run(action: () => Promise<void>): Promise<boolean> {
    busy = true;
    error = null;
    try {
      await action();
      return true;
    } catch (err) {
      error = (err as Error).message;
      return false;
    } finally {
      busy = false;
      await Promise.all([stock.refresh(), expiring.refresh()]);
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
  /** « Jeté » sur un lot passé : tout ce lot sort (compté périmé), puis la proposition de courses habituelle. */
  const throwLot = (entry: StockEntry, lot: LotView) => run(async () => proposeShopping(await api.stockOut(entry.product.code, { all: true, lotId: lot.id })));
  const keepLot = (lot: LotView) => run(async () => void (await api.setLot(lot.id, { dismissed: true })));
  const saveLot = (lot: LotView, change: Parameters<typeof api.setLot>[1]) =>
    run(async () => {
      await api.setLot(lot.id, change);
      dialog = null;
    });
  const lotsOf = (code: string) => stock.data?.items.find((i) => i.product.code === code)?.lots ?? null;
  const addContainer = (name: string) =>
    run(async () => {
      dialog = { kind: 'label', container: await api.addContainer(name) };
    });
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
      <button type="button" class="btn" aria-label="Sans code-barres" onclick={() => (dialog = { kind: 'loose' })}><Icon name="plus" size={24} />{#if !phone}Sans code-barres{/if}</button>
      <button type="button" class="btn primary" aria-label="Scanner" onclick={() => navigate(phone ? PHONE_SCAN_PATH : detailPath('scan', router.route))}><Icon name="barcode" size={24} />{#if !phone}Scanner{/if}</button>
    {/if}
  </header>

  {#if error}<p class="error">{error}</p>{/if}

  {#if stock.data}
    {@const data = stock.data}
    <div class="columns">
      <section class="card products">
        <StockList
          items={data.items}
          bind:filter
          {search}
          {phone}
          {readOnly}
          {busy}
          now={clock.now}
          {nameOf}
          onOpen={(entry) => (dialog = { kind: 'sheet', product: entry.product, quantity: entry.quantity })}
          onPlus={plus}
          onMinus={minus}
          onExhaust={exhaust}
          {today}
          thrown={expiring.data?.thrownThisMonth ?? null}
          onDate={(entry, lot) => (dialog = { kind: 'date', entry, lot })}
          onThrow={throwLot}
          onKeep={(_, lot) => keepLot(lot)}
        />
      </section>

      <div class="side">
        <section class="card">
          <h2 class="card-label">Contenants de la maison</h2>
          {#if !phone}<p class="muted small">Bidon de lessive, bocal à farine… : on y transvase les recharges. Leur étiquette se scanne pour les déclarer vides.</p>{/if}
          <ContainersList
            containers={data.containers}
            {phone}
            {readOnly}
            {busy}
            onEmpty={emptyContainer}
            onLabel={(container) => (dialog = { kind: 'label', container })}
            onAdd={addContainer}
          />
        </section>

        {#if !phone}<section class="card">
          <h2 class="card-label">Produit épuisé</h2>
          <div class="chips">
            <button type="button" class:on={!data.settings.autoShop} disabled={busy || readOnly} onclick={() => setAutoShop(false)}>Demander avant d’ajouter aux courses</button>
            <button type="button" class:on={data.settings.autoShop} disabled={busy || readOnly} onclick={() => setAutoShop(true)}>L’ajouter d’office aux courses</button>
          </div>
          <p class="muted small">Chaque produit peut avoir son propre réglage (toucher son nom).</p>
        </section>
        <section class="card">
          <h2 class="card-label">Dates de péremption</h2>
          <p class="muted small">
            DLC urgente dans {data.settings.expiry.urgentDlcDays} j, bientôt dans {data.settings.expiry.soonDlcDays} j · DDM bientôt dans {data.settings.expiry.soonDdmDays} j. Sans date imprimée : estimée d’après le rayon.
          </p>
          {#if expiring.data}<p class="small">{thrownText(expiring.data.thrownThisMonth)}</p>{/if}
          <div><button type="button" class="btn small" onclick={() => (dialog = { kind: 'expiry' })}><Icon name="settings" size={20} /> Régler</button></div>
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
      opened={stock.data?.items.find((i) => i.product.code === d.product.code)?.opened ?? null}
      containers={stock.data?.containers ?? []}
      lots={lotsOf(d.product.code)}
      expiry={stock.data?.settings.expiry ?? null}
      {readOnly}
      onChange={(product) => {
        dialog = { ...d, product };
        void stock.refresh();
      }}
      onClose={() => (dialog = null)}
    />
  </Modal>
{:else if dialog?.kind === 'loose'}
  <Modal label="Produit sans code-barres" onClose={() => (dialog = null)}>
    <LooseForm
      title="Produit sans code-barres"
      onSubmit={async (input) => {
        const result = await api.addLooseProduct(input);
        await stock.refresh();
        filter = 'in';
        dialog = result.product ? { kind: 'sheet', product: result.product, quantity: result.quantity } : null;
      }}
      onCancel={() => (dialog = null)}
    />
  </Modal>
{:else if dialog?.kind === 'date'}
  {@const d = dialog}
  <Modal label="Date de péremption" onClose={() => (dialog = null)}>
    <DatePad title={d.entry.product.current.name} lot={d.lot} {today} {busy} onSave={(change) => saveLot(d.lot, change)} onSkip={() => (dialog = null)} />
  </Modal>
{:else if dialog?.kind === 'expiry' && stock.data}
  <ExpirySettingsDialog settings={stock.data.settings.expiry} onSaved={() => void stock.refresh()} onClose={() => (dialog = null)} />
{:else if dialog?.kind === 'shop'}
  {@const d = dialog}
  <Modal label="Liste de courses" locked>
    <ShopPrompt code={d.code} label={d.label} onDone={() => (dialog = null)} />
  </Modal>
{:else if dialog?.kind === 'label'}
  {@const d = dialog}
  {#key d.container.id}
    <ContainerLabelDialog
      container={d.container}
      {readOnly}
      {busy}
      onRename={(name) =>
        run(async () => {
          dialog = { kind: 'label', container: await api.renameContainer(d.container.id, name) };
        })}
      onRemove={() =>
        run(async () => {
          await api.removeContainer(d.container.id);
          dialog = null;
        })}
      onClose={() => (dialog = null)}
    />
  {/key}
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

  .side > :global(*) {
    flex-shrink: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

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

  .chips button.on {
    background: var(--rain);
    color: var(--bg);
    font-weight: 600;
  }

  /* Téléphone : une seule colonne, toute la page défile (la liste : voir StockList). */
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

  .phone header {
    gap: 8px;
  }

  .phone header .search + .btn {
    margin-left: auto;
  }

  /* Boutons sans texte (sans code-barres, scanner) : ronds, pour tenir sur une ligne avec « Courses ». */
  .phone header .search ~ .btn {
    width: 52px;
    padding: 0;
  }

  .phone .card {
    padding: 12px;
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

  .phone .side {
    flex: none;
    overflow: visible;
  }
</style>
