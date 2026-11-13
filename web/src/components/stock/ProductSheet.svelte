<script lang="ts">
  import { isLooseCode } from '../../../../shared/barcode.ts';
  import { looseAmount } from '../../../../shared/loose.ts';
  import type { Container, ExpirySettings, LotView, Product, ProductRecheck, StockMovement } from '../../../../shared/types.ts';
  import { getAppContext } from '../../lib/context.ts';
  import { infoDiff, looseText, markLine, movementLabel, productDetail, productSubtitle, provenance, stockText } from '../../lib/stock.ts';
  import LooseForm from './LooseForm.svelte';
  import ProductDates from './ProductDates.svelte';
  import ProductForm from './ProductForm.svelte';

  // Fiche d'un produit (scanner, stock) : ce qu'on en sait et d'où ça vient ; « Ce n'est pas ça ? » → Revérifier
  // (relecture de la base, différences à accepter ou non) ou Corriger (notre version) ; conflit avec la base à
  // trancher ; réglages (liste de courses d'office, contenant où on le transvase). Sans code-barres : pas de base à
  // relire, mais sa quantité se change ici (« il reste 800 g », racheté). Dates de péremption : ProductDates.svelte.
  type Props = {
    product: Product;
    quantity: number | null;
    /** Part restante du paquet entamé, notée en cuisinant (null : inconnue). */
    opened?: number | null;
    containers: Container[];
    /** Lots du produit et réglages des dates (absents au scanner : seulement les réglages du produit). */
    lots?: LotView[] | null;
    expiry?: ExpirySettings | null;
    readOnly?: boolean;
    onChange: (product: Product) => void;
    onClose: () => void;
  };
  let { product, quantity, opened = null, containers, lots = null, expiry = null, readOnly = false, onChange, onClose }: Props = $props();

  const { api, clock, config } = getAppContext();
  const nameOf = (ownerId: string | null) => (ownerId ? (config.members.find((m) => m.id === ownerId)?.name ?? null) : null);

  /** Historique : chaque entrée et sortie, quand et par qui (relu quand la fiche change de produit). */
  let history = $state<StockMovement[] | null>(null);
  $effect(() => {
    const code = product.code;
    let current = true;
    void api.stockMovements(code).then((list) => current && (history = list)).catch(() => current && (history = []));
    return () => (current = false);
  });

  let mode = $state<'view' | 'correct' | 'amount'>('view');
  const loose = $derived(isLooseCode(product.code));
  /** Quantité affichée par la fiche (après « Modifier la quantité », la nouvelle). */
  let shown = $state<number | null>(null);
  const count = $derived(shown ?? quantity);
  let recheck = $state<ProductRecheck | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function run(action: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await action();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  const reverify = () => run(async () => void (recheck = await api.recheckProduct(product.code)));
  const takeBase = () =>
    run(async () => {
      onChange(await api.acceptBase(product.code));
      recheck = null;
    });
  const resolve = (take: 'mine' | 'base') => run(async () => onChange(await api.resolveConflict(product.code, take)));
  const setAutoShop = (autoShop: boolean | null) => run(async () => onChange(await api.setProductPreferences(product.code, { autoShop })));
  const setRefill = (refill: string | null) => run(async () => onChange(await api.setProductPreferences(product.code, { refill })));

  const SHOP_CHOICES: { value: boolean | null; label: string }[] = [
    { value: null, label: 'Comme le réglage du stock' },
    { value: true, label: 'L’ajouter d’office' },
    { value: false, label: 'Demander' },
  ];
</script>

{#if mode === 'amount'}
  {@const total = looseAmount(product.current.quantity, count ?? 0)}
  <LooseForm
    title={`Quantité : ${product.current.name}`}
    amountOnly
    initial={total && total.amount > 0 ? total : total ? { unit: total.unit } : null}
    submitLabel="Enregistrer"
    onSubmit={async ({ amount, unit }) => {
      const result = await api.setLooseAmount(product.code, amount, unit);
      shown = result.quantity;
      if (result.product) onChange(result.product);
      mode = 'view';
    }}
    onCancel={() => (mode = 'view')}
  />
{:else if mode === 'correct'}
  <ProductForm
    title={loose ? 'Nom et rayon' : 'Corriger le produit'}
    code={product.code}
    initial={product.current}
    hint="notre version l’emportera sur la base"
    onSubmit={async (info) => {
      onChange(await api.saveProduct(product.code, info));
      mode = 'view';
    }}
    onCancel={() => (mode = 'view')}
  />
{:else}
  <div class="head">
    {#if product.image}<img src={product.image} alt="" />{/if}
    <div class="title">
      <h2>{product.current.name}</h2>
      {#if loose}
        <span class="muted">{productSubtitle(product)}</span>
        <span class="small">{provenance(product)}{count !== null ? ` · ${count > 0 ? `${looseText(product, count) ?? count} en stock` : 'Épuisé'}` : ''}</span>
      {:else}
        <span class="muted">{productDetail(product.current) || 'Marque et contenance inconnues'}{product.current.category ? ` · ${product.current.category}` : ''}</span>
        <span class="small">{provenance(product)}{count !== null ? ` · ${stockText(count, shown === null ? opened : null)}` : ''}</span>

      {/if}
    </div>
  </div>

  {#if product.conflict}
    {@const diff = infoDiff(product.current, product.conflict)}
    <div class="notice">
      <strong>La base dit maintenant autre chose</strong>
      {#each diff as row (row.label)}
        <span>{row.label} : « {row.theirs} », tu avais mis « {row.mine} »</span>
      {/each}
      <div class="row">
        <button type="button" class="btn small" disabled={busy} onclick={() => resolve('mine')}>Garder la nôtre</button>
        <button type="button" class="btn small primary" disabled={busy} onclick={() => resolve('base')}>Passer à celle de la base</button>
      </div>
    </div>
  {/if}

  {#if loose}<section>
    <h3 class="card-label">Sans code-barres</h3>
    <p class="muted">Ajouté à la main, jamais cherché dans une base de produits.</p>
    <div class="row">
      <button type="button" class="btn small primary" disabled={busy} onclick={() => (mode = 'amount')}>Modifier la quantité</button>
      <button type="button" class="btn small" disabled={busy} onclick={() => (mode = 'correct')}>Nom et rayon</button>
    </div>
  </section>{:else}<section>
    <h3 class="card-label">Ce n’est pas ça ?</h3>
    {#if recheck}
      {#if recheck.baseError}
        <p class="muted">La base ne répond pas : réessaie plus tard, ou corrige à la main.</p>
      {:else if !recheck.base}
        <p class="muted">Ce produit n’est pas dans la base : seule la correction à la main est possible.</p>
      {:else if !recheck.differs}
        <p class="muted">La base dit la même chose que la fiche.</p>
      {:else}
        <table>
          <thead><tr><th></th><th>Fiche</th><th>Base</th></tr></thead>
          <tbody>
            {#each infoDiff(recheck.current, recheck.base) as row (row.label)}
              <tr><th>{row.label}</th><td>{row.mine}</td><td>{row.theirs}</td></tr>
            {/each}
          </tbody>
        </table>
        <div class="row">
          <button type="button" class="btn small" onclick={() => (recheck = null)}>Garder la fiche</button>
          <button type="button" class="btn small primary" disabled={busy} onclick={takeBase}>Prendre la version de la base</button>
        </div>
      {/if}
    {/if}
    <div class="row">
      <button type="button" class="btn small" disabled={busy} onclick={reverify}>Revérifier</button>
      <button type="button" class="btn small" disabled={busy} onclick={() => (mode = 'correct')}>Corriger</button>
    </div>
  </section>{/if}

  <ProductDates {product} {lots} {expiry} {readOnly} {onChange} />

  <section>
    <h3 class="card-label">Épuisé : liste de courses</h3>
    <div class="chips">
      {#each SHOP_CHOICES as choice (String(choice.value))}
        <button type="button" class:on={product.autoShop === choice.value} disabled={busy} onclick={() => setAutoShop(choice.value)}>{choice.label}</button>
      {/each}
    </div>
  </section>

  {#if containers.length}
    <section>
      <h3 class="card-label">Transvasé dans</h3>
      <div class="chips">
        <button type="button" class:on={product.refill === null} disabled={busy} onclick={() => setRefill(null)}>Aucun contenant</button>
        {#each containers as container (container.id)}
          <button type="button" class:on={product.refill === container.id} disabled={busy} onclick={() => setRefill(container.id)}>{container.name}</button>
        {/each}
      </div>
    </section>
  {/if}

  <section>
    <h3 class="card-label">Entrées et sorties</h3>
    {#if history === null}
      <p class="muted">Chargement…</p>
    {:else if history.length === 0}
      <p class="muted">{loose ? 'Aucun mouvement.' : 'Jamais scanné.'}</p>
    {:else}
      <ul class="history">
        {#each history.slice(0, 12) as m (m.id)}
          <li class:undone={m.undone}>
            <strong>{movementLabel(m)}{m.undone ? ' · annulé' : ''}</strong>
            <span>{markLine(m, clock.now, nameOf)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if error}<p class="error">{error}</p>{/if}
  <div class="row end">
    <button type="button" class="btn" onclick={onClose}>Fermer</button>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  img {
    width: 72px;
    height: 72px;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    background: #fff;
    object-fit: contain;
  }

  .title {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  .muted {
    color: var(--fg-muted);
  }

  .small {
    color: var(--fg-muted);
    font-size: 0.95rem;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .notice {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--warn-bg);
    color: var(--warn);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .row.end {
    justify-content: flex-end;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .chips button {
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
  }

  .chips button.on {
    background: var(--rain);
    color: var(--bg);
    font-weight: 600;
  }

  table {
    border-collapse: collapse;
  }

  th,
  td {
    padding: 6px 12px 6px 0;
    text-align: left;
  }

  thead th {
    color: var(--fg-muted);
    font-weight: 600;
  }

  tbody th {
    color: var(--fg-muted);
    font-weight: 400;
  }

  .history {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .history li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-variant-numeric: tabular-nums;
  }

  .history li span {
    color: var(--fg-muted);
  }

  .history li.undone {
    opacity: 0.55;
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }
</style>
