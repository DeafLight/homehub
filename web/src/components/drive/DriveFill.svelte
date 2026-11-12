<script lang="ts">
  import { countFlag, type DriveView, driveRecap, enseigneName, fillRows, type FillRow, formatCount, itemName, linePrice, packPrice, piecesUnit } from '../../../../shared/drive.ts';
  import { cartFor, formatPrice, readReport, reportSummary } from '../../../../shared/drive-cart.ts';
  import type { ShoppingItem } from '../../../../shared/types.ts';
  import type { Api } from '../../lib/api.ts';
  import { revert } from '../../lib/checkbox.ts';
  import { itemAmount } from '../../lib/drive.ts';
  import { byAisle, itemAisle } from '../../lib/menu.ts';
  import Icon from '../Icon.svelte';
  import DrivePieces from './DrivePieces.svelte';

  // Mode « Remplir le panier » : les articles à acheter dans l'ordre des rayons, chacun avec son produit retenu chez
  // l'enseigne, le nombre de paquets et le lien qui ouvre sa fiche. On remplit le panier dans l'appli de l'enseigne et
  // on coche ici (le serveur garde le panier en cours). Récapitulatif : ce qui part au drive, ce qui reste à mettre au
  // panier, ce qui s'achète ailleurs ; pas de prix. Les articles cochés sont marqués « au drive » dans les courses,
  // sans être cochés comme achetés. « Nouveau panier » retire toutes les coches (demandé deux fois).
  // Onglet « Extension » (étape 3) : copier le panier (ce qui reste à mettre au panier avec un produit retenu) pour
  // l'extension « Remplir le panier », puis recoller son compte rendu pour marquer les lignes et noter les prix vus ;
  // le récapitulatif en tire un total indicatif.
  type Props = {
    api: Api;
    items: ShoppingItem[];
    view: DriveView;
    readOnly?: boolean;
    /** Vue à jour renvoyée par le serveur après une coche. */
    onView: (view: DriveView) => void;
    /** Après un changement de produit (pièces par paquet) : la vue est rechargée par le parent. */
    onChanged: () => Promise<void> | void;
    onClose: () => void;
  };
  let { api, items, view, readOnly = false, onView, onChanged, onClose }: Props = $props();

  const enseigne = $derived(view.settings.enseigne);
  const rows = $derived(fillRows(items, view));
  const groups = $derived(byAisle(rows, (r) => itemAisle(r.item)));
  /** Récapitulatif dans l'ordre des rayons, comme la liste. */
  const recap = $derived(driveRecap(groups.flatMap((g) => g.items)));
  /** Panier à copier pour l'extension, dans l'ordre des rayons. */
  const cart = $derived(enseigne ? cartFor(groups.flatMap((g) => g.items), enseigne, view.settings.store?.name ?? null) : null);
  const cartText = $derived(cart ? JSON.stringify(cart) : '');
  const cartPacks = $derived(cart?.lines.reduce((sum, l) => sum + l.count, 0) ?? 0);

  let tab = $state<'list' | 'recap' | 'extension'>('list');
  let copied = $state<'yes' | 'manual' | null>(null);
  let reportText = $state('');
  let reportDone = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let confirmNew = $state(false);

  async function run(id: string, task: () => Promise<DriveView>) {
    busy = id;
    error = null;
    try {
      onView(await task());
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = null;
    }
  }

  const toggle = (row: FillRow, inBasket: boolean) => run(row.item.id, () => api.setInBasket(row.item.id, inBasket));
  const newBasket = () => run('new', async () => ((confirmNew = false), await api.newBasket()));

  async function copyCart() {
    try {
      await navigator.clipboard.writeText(cartText);
      copied = 'yes';
    } catch {
      // Presse-papiers refusé (adresse sans HTTPS…) : le texte est montré, à copier à la main.
      copied = 'manual';
    }
  }

  function sendReport() {
    const parsed = readReport(reportText);
    reportDone = null;
    if (!parsed.ok) {
      error = parsed.error;
      return;
    }
    return run('report', async () => {
      const result = await api.sendDriveReport(parsed.value);
      reportDone = reportSummary(result);
      reportText = '';
      return result.view;
    });
  }
</script>

<div class="drive-fill">
  <h2><Icon name="cart" size={26} /> Remplir le panier</h2>
  {#if !enseigne}
    <p>Choisis d’abord une enseigne dans les réglages du drive (bouton « Drive » des courses).</p>
    <div class="actions"><button type="button" class="btn" onclick={onClose}>Fermer</button></div>
  {:else}
    <p class="muted">
      {enseigneName(enseigne)}{view.settings.store ? ` · ${view.settings.store.name}` : ''} ·
      <strong class="progress">{recap.drive.length} sur {rows.length} au panier</strong>{recap.packs > 0 ? ` · ${recap.packs} paquet${recap.packs > 1 ? 's' : ''}` : ''}
    </p>

    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="btn small" class:primary={tab === 'list'} aria-selected={tab === 'list'} onclick={() => (tab = 'list')}>Liste</button>
      <button type="button" role="tab" class="btn small" class:primary={tab === 'recap'} aria-selected={tab === 'recap'} onclick={() => (tab = 'recap')}>Récapitulatif</button>
      <button type="button" role="tab" class="btn small" class:primary={tab === 'extension'} aria-selected={tab === 'extension'} onclick={() => (tab = 'extension')}>Extension</button>
    </div>

    {#if error}<p class="error">{error}</p>{/if}

    {#if tab === 'list'}
      <p class="muted small">Ouvre la fiche dans l’appli {enseigneName(enseigne)}, ajoute les paquets indiqués, puis coche.</p>
      {#each groups as group (group.aisle)}
        {#if groups.length > 1}<h3 class="aisle">{group.aisle}</h3>{/if}
        <ul class="rows">
          {#each group.items as row (row.item.id)}
            {@render fillRow(row)}
          {/each}
        </ul>
      {:else}
        <p class="muted">Rien à acheter.</p>
      {/each}
    {:else if tab === 'extension'}
      <section class="extension">
        <p class="muted small">
          Sur ordinateur (Chrome, Edge, Firefox) ou avec Firefox sur Android, l’extension « HomeHub · Remplir le panier » ajoute
          ces produits à ton panier {enseigneName(enseigne)}, depuis ton compte, une fiche après l’autre. Elle s’arrête au premier
          captcha ou refus ; tu finis à la main. Rien n’est payé, aucun créneau n’est réservé.
        </p>
        <h3>1. Copier le panier · {cart?.lines.length ?? 0} produit{(cart?.lines.length ?? 0) > 1 ? 's' : ''}, {cartPacks} paquet{cartPacks > 1 ? 's' : ''}</h3>
        {#if cart && cart.lines.length > 0}
          <p class="muted small">Les articles qui ont un produit retenu et ne sont pas encore cochés. Colle-le dans le panneau de l’extension, sur le site {enseigneName(enseigne)} ouvert et connecté.</p>
          <div class="actions"><button type="button" class="btn primary" onclick={copyCart}><Icon name="share" size={18} /> Copier pour l’extension</button></div>
          {#if copied === 'yes'}<p class="ok small">Copié : colle-le dans le panneau de l’extension.</p>{/if}
          {#if copied === 'manual'}
            <p class="flag">Copie refusée par le navigateur : sélectionne le texte ci-dessous et copie-le.</p>
            <textarea class="json" readonly value={cartText} onfocus={(e) => e.currentTarget.select()}></textarea>
          {/if}
        {:else}
          <p class="muted">Rien à envoyer : tout ce qui a un produit retenu est déjà coché.</p>
        {/if}
        <h3>2. Recoller le compte rendu</h3>
        {#if readOnly}
          <p class="muted small">Pour marquer les lignes, ouvre HomeHub sur un appareil relié (téléphone, ou ordinateur relié comme un téléphone), ou présente-toi à la tablette.</p>
        {:else}
          <p class="muted small">À la fin, copie le compte rendu dans le panneau de l’extension et colle-le ici : les articles partis sont cochés « au drive », les prix vus sont notés.</p>
          <textarea class="json" bind:value={reportText} placeholder="Compte rendu copié depuis l’extension"></textarea>
          <div class="actions"><button type="button" class="btn" disabled={busy !== null || !reportText.trim()} onclick={sendReport}>Marquer les lignes</button></div>
          {#if reportDone}<p class="ok small">{reportDone}</p>{/if}
        {/if}
      </section>
    {:else}
      <section class="recap">
        <h3>Part au drive · {recap.drive.length} article{recap.drive.length > 1 ? 's' : ''}, {recap.packs} paquet{recap.packs > 1 ? 's' : ''}</h3>
        {#each recap.drive as row (row.item.id)}
          {@const price = linePrice(row)}
          <p class="recap-row">
            <span>{itemName(row.item)} <span class="muted">· {row.line?.product?.name ?? 'sans produit retenu'}</span></span>
            <strong>{row.line ? formatCount(row.line) : ''}{price !== null ? ` · ${formatPrice(price)}` : ''}</strong>
          </p>
          {#if row.changed}<p class="flag">Changé depuis : il faut maintenant {row.count ? formatCount(row.count) : 'choisir un produit'}</p>{/if}
          {#if row.count?.flag}<p class="flag">{countFlag(row.count.flag)}</p>{/if}
        {:else}
          <p class="muted">Rien de coché pour l’instant.</p>
        {/each}
        {#if recap.total > 0}
          <p class="recap-row total">
            <span>Total indicatif{recap.unpriced > 0 ? ` (${recap.unpriced} sans prix)` : ''}</span>
            <strong>{formatPrice(recap.total)}</strong>
          </p>
        {/if}

        {#if recap.toFill.length > 0}
          <h3>Reste à mettre au panier · {recap.toFill.length}</h3>
          {#each recap.toFill as row (row.item.id)}
            <p class="recap-row"><span>{itemName(row.item)}</span><strong>{row.count ? formatCount(row.count) : ''}</strong></p>
          {/each}
        {/if}

        <h3>À acheter ailleurs · {recap.elsewhere.length}</h3>
        {#each recap.elsewhere as row (row.item.id)}
          <p class="recap-row">
            <span>{itemName(row.item)}{itemAmount(row.item) ? ` · ${itemAmount(row.item)}` : ''}</span>
            <span class="muted">{row.status === 'fallback' ? 'seulement des secours' : 'aucun produit retenu'}</span>
          </p>
        {:else}
          <p class="muted">Rien : tout a un produit chez {enseigneName(enseigne)}.</p>
        {/each}
        <p class="muted small">Prix vus sur les fiches par l’extension, indicatifs : le vrai total, le créneau et le paiement se voient dans l’appli {enseigneName(enseigne)}. Les articles cochés sont marqués « au drive » dans les courses ; coche-les comme achetés une fois le panier retiré.</p>
      </section>
    {/if}

    <div class="actions">
      {#if !readOnly && recap.drive.length > 0}
        {#if confirmNew}
          <button type="button" class="btn" disabled={busy !== null} onclick={newBasket}>Oui, tout décocher</button>
          <button type="button" class="btn" onclick={() => (confirmNew = false)}>Non</button>
        {:else}
          <button type="button" class="btn" onclick={() => (confirmNew = true)}>Nouveau panier</button>
        {/if}
      {/if}
      <button type="button" class="btn primary" onclick={onClose}>Fermer</button>
    </div>
  {/if}
</div>

{#snippet fillRow(row: FillRow)}
  {@const product = row.choice?.preferred ?? null}
  {@const unit = product ? piecesUnit(row.item, product) : null}
  <li class:in={row.line !== null}>
    <input
      type="checkbox"
      aria-label="Au panier : {itemName(row.item)}"
      checked={row.line !== null}
      disabled={readOnly || busy !== null}
      onchange={(e) => toggle(row, revert(e.currentTarget, row.line !== null))}
    />
    <div class="what">
      <span class="name">{itemName(row.item)}{#if itemAmount(row.item)}<span class="muted">{` · ${itemAmount(row.item)}`}</span>{/if}</span>
      {#if product && row.count}
        <span class="product">{product.name}</span>
        {@const price = packPrice(row, product.id)}
        <span class="count">{formatCount(row.count)}{#if price}<span class="muted price">{` · ${formatPrice(price.value)} le paquet`}</span>{/if}</span>
        {#if countFlag(row.count.flag) && !(unit && !readOnly)}<span class="flag">{countFlag(row.count.flag)}</span>{/if}
        {#if unit && enseigne}
          {#key product.id}
            <DrivePieces {api} itemKey={row.key} {product} {unit} {readOnly} {onChanged} />
          {/key}
        {/if}
      {:else if row.status === 'fallback'}
        <span class="flag">Seulement des secours : choisis-en un avec le chariot de l’article</span>
      {:else}
        <span class="muted small">Aucun produit retenu : à chercher dans l’appli ou ailleurs</span>
      {/if}
      {#if row.changed && row.line}
        <span class="flag">
          Changé depuis : {formatCount(row.line)} au panier{row.count ? `, il faut ${formatCount(row.count)}` : ''}
          {#if !readOnly}<button type="button" class="link" disabled={busy !== null} onclick={() => toggle(row, true)}>Mettre à jour</button>{/if}
        </span>
      {/if}
    </div>
    {#if product}
      <a class="btn small" href={product.url} target="_blank" rel="noreferrer noopener"><Icon name="link" size={18} /> Fiche</a>
    {/if}
  </li>
{/snippet}

<style>
  .drive-fill {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: var(--text-title);
  }

  p {
    margin: 0;
  }

  .muted {
    color: var(--fg-muted);
  }

  .small {
    font-size: var(--text-small);
  }

  .progress {
    color: var(--fg);
  }

  .error {
    color: var(--danger-fg);
  }

  .tabs,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .aisle {
    margin: var(--space-1) 0 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--fg-muted);
  }

  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--surface-2);
  }

  li:last-child {
    border-bottom: 0;
  }

  li.in .name {
    color: var(--fg-muted);
  }

  input[type='checkbox'] {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    margin: 0;
    accent-color: var(--ok);
  }

  .what {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .name {
    font-size: 1.1rem;
    font-weight: 600;
  }

  .product {
    font-size: var(--text-small);
    color: var(--fg-soft);
  }

  .count {
    font-weight: 700;
    color: var(--rain-soft);
  }

  .flag {
    font-size: var(--text-small);
    color: var(--sun);
  }

  .link {
    margin-left: 6px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--rain-soft);
    font: inherit;
    font-weight: 600;
  }

  a.btn {
    flex-shrink: 0;
    text-decoration: none;
  }

  .ok {
    color: var(--ok);
  }

  .price {
    font-weight: 400;
  }

  .extension {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .extension h3,
  .recap h3 {
    margin: var(--space-1) 0 0;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .json {
    width: 100%;
    min-height: 88px;
    padding: 8px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--fg);
    font: 0.8rem/1.3 ui-monospace, monospace;
    box-sizing: border-box;
  }

  .recap-row.total {
    padding-top: 6px;
    border-top: 1px solid var(--surface-2);
  }

  .recap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .recap-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .recap-row strong {
    flex-shrink: 0;
    color: var(--rain-soft);
  }
</style>
