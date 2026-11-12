<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    choiceFor,
    type DriveProduct,
    type DriveProductDraft,
    type DriveStockHint,
    type DriveView,
    enseigneName,
    itemKey,
    itemName,
    missingOf,
    missingState,
    missingTrace,
    piecesUnit,
  } from '../../../../shared/drive.ts';
  import type { ShoppingItem } from '../../../../shared/types.ts';
  import type { Api } from '../../lib/api.ts';
  import { eanMessage, packLabel, packsPreview } from '../../lib/drive.ts';
  import Icon from '../Icon.svelte';
  import DrivePieces from './DrivePieces.svelte';

  // « Produit chez <enseigne> » pour un article de la liste de courses : le produit retenu (contenance, EAN, paquets),
  // ses secours, et le choix d'un produit en collant (ou en partageant) le lien de sa fiche. La fiche n'est lue qu'en
  // touchant « Lire la fiche » ; si le site refuse, on saisit le nom et la contenance, ou on les reprend d'un produit
  // du stock (par EAN). Un secours n'est jamais pris d'office : il faut le choisir. Article compté en pièces et paquet
  // d'une autre contenance (« 2 oignons », filet de 1 kg) : « Combien de pièces dans ce paquet ? », retenu sur le produit.
  // Article introuvable ou en rupture pour le panier en cours : on le dit, et on propose de le remplacer pour ce panier
  // par un secours (choisi ici, jamais pris d'office) ou par un autre produit lu par sa fiche, qui devient un secours.
  // Un produit garde la trace de sa dernière rupture (« Introuvable ou en rupture le 12/11 »).
  type Props = {
    api: Api;
    item: ShoppingItem;
    view: DriveView;
    /** Lien reçu par « Partager » : lu tout de suite. */
    initialUrl?: string;
    readOnly?: boolean;
    /** Après un changement : la vue à jour est rechargée par le parent. */
    onChanged: () => Promise<void> | void;
    onClose: () => void;
  };
  let { api, item, view, initialUrl, readOnly = false, onChanged, onClose }: Props = $props();

  const enseigne = $derived(view.settings.enseigne);
  const key = $derived(itemKey(item));
  const choice = $derived(enseigne ? choiceFor(view.choices, key, enseigne) : null);
  const missing = $derived(missingState(choice, missingOf(view, item.id)));

  let url = $state(untrack(() => initialUrl ?? ''));
  let draft = $state<DriveProductDraft | null>(null);
  let source = $state<DriveProduct['source']>('manual');
  let reason = $state<string | null>(null);
  let refused = $state(false);
  let hints = $state<DriveStockHint[]>([]);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  const preview = $derived(draft ? packsPreview(item, draft.packText) : null);
  const ean = $derived(draft ? eanMessage(draft.ean, hints) : null);

  async function run(label: string, task: () => Promise<unknown>) {
    busy = label;
    error = null;
    try {
      await task();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = null;
    }
  }

  async function read(event?: SubmitEvent) {
    event?.preventDefault();
    if (!url.trim() || busy) return;
    await run('Lecture de la fiche…', async () => {
      const result = await api.readDriveProduct(url.trim());
      draft = { ...result.product };
      source = result.read ? 'page' : 'manual';
      reason = result.read ? null : result.reason;
      refused = !result.read && result.refused === true;
      url = result.product.url;
    });
  }

  function take(hint: DriveStockHint) {
    if (!draft) return;
    draft = { ...draft, name: draft.name || [hint.name, hint.brand].filter(Boolean).join(' '), packText: hint.quantity ?? draft.packText, ean: hint.ean };
    if (source !== 'page') source = 'stock';
  }

  /** Retenir le produit lu ; `replace` : en secours, et remplacement du produit introuvable pour ce panier. */
  async function save(role: 'preferred' | 'fallback', replace = false) {
    const current = draft;
    if (!current) return;
    await run('Enregistrement…', async () => {
      await api.chooseDriveProduct({ key, label: itemName(item), role, product: { url: current.url, name: current.name.trim(), brand: current.brand, packText: current.packText?.trim() || null, ean: current.ean?.trim() || null, source } });
      if (replace) await api.setDriveMissing(item.id, { replacement: current.id });
      draft = null;
      url = '';
      await onChanged();
    });
  }

  const replaceWith = (id: string | null) => run('Enregistrement…', async () => (await api.setDriveMissing(item.id, { replacement: id }), await onChanged()));
  const forget = (id?: string) => run('Retrait…', async () => (await api.forgetDriveProduct(key, id), await onChanged()));
  const promote = (product: DriveProduct) =>
    run('Enregistrement…', async () => {
      await api.chooseDriveProduct({ key, label: itemName(item), role: 'preferred', product });
      await onChanged();
    });

  onMount(() => {
    void api
      .driveStock(key)
      .then((r) => (hints = r.hints))
      .catch(() => {});
    if (initialUrl) void read();
  });
</script>

<div class="drive">
  <h2><Icon name="cart" size={26} /> {enseigne ? `Produit chez ${enseigneName(enseigne)}` : 'Drive'}</h2>
  <p class="muted">{itemName(item)}{item.menu ? ` · ${item.label.split(' · ')[1] ?? ''}` : ''}</p>

  {#if !enseigne}
    <p>Choisis d’abord une enseigne dans les réglages du drive (bouton « Drive » des courses).</p>
  {:else}
    {#if missing.active && choice?.preferred}
      <p class="notice missing">
        <strong>{choice.preferred.name}</strong> est introuvable ou en rupture pour ce panier.
        {missing.replacement ? 'Remplacé par un secours, ci-dessous.' : missing.proposals.length > 0 ? 'Remplace-le par un secours, ou par un autre produit.' : 'Remplace-le par un autre produit (lien de sa fiche), ou achète-le ailleurs.'}
      </p>
    {/if}
    {#if choice?.preferred}
      {@render productCard(choice.preferred, true)}
    {:else if choice}
      <p class="notice">Aucun produit retenu : choisis un des secours, ou un autre produit.</p>
    {/if}
    {#each choice?.fallback ?? [] as product (product.id)}
      {@render productCard(product, false)}
    {/each}

    {#if !readOnly}
      <form class="block" onsubmit={read}>
        <label>
          <span class="muted">{choice ? 'Autre produit' : 'Choisir un produit'} : sur le site ou l’appli {enseigneName(enseigne)}, ouvre sa fiche puis <strong>Partager › HomeHub</strong>, ou copie son lien ici.</span>
          <input type="url" inputmode="url" bind:value={url} placeholder="https://www.coursesu.com/p/…" />
        </label>
        <div class="actions">
          <button type="submit" class="btn primary" disabled={busy !== null || !url.trim()}><Icon name="link" size={22} /> Lire la fiche</button>
          <button type="button" class="btn" onclick={onClose}>Fermer</button>
        </div>
      </form>
    {:else}
      <div class="actions"><button type="button" class="btn" onclick={onClose}>Fermer</button></div>
    {/if}

    {#if busy}
      <p class="muted" role="status">{busy}</p>
    {:else if error}
      <p class="error">{error}</p>
    {/if}

    {#if draft}
      <div class="draft" class:refused>
        {#if reason}<p><strong>{reason}.</strong></p>{:else}<p class="ok-text">Fiche lue : vérifie avant de retenir.</p>{/if}
        <label><span class="muted">Nom du produit</span><input bind:value={draft.name} maxlength="120" placeholder="Lardons fumés" /></label>
        <div class="row">
          <label><span class="muted">Contenance du paquet</span><input bind:value={draft.packText} maxlength="40" placeholder="200 g" /></label>
          <label><span class="muted">Code-barres (EAN)</span><input bind:value={draft.ean} inputmode="numeric" maxlength="14" placeholder="facultatif" /></label>
        </div>
        {#if preview}<p class="packs">À prendre : <strong>{preview}</strong></p>{/if}
        {#if ean}<p class:ok-text={ean.ok} class:warn-text={!ean.ok}>{ean.text}</p>{/if}
        {#if hints.length > 0}
          <div class="hints">
            <span class="muted small">Au stock :</span>
            {#each hints as hint (hint.ean)}
              <button type="button" class="btn small" onclick={() => take(hint)}>{hint.name}{hint.quantity ? ` · ${hint.quantity}` : ''}</button>
            {/each}
          </div>
        {/if}
        <div class="actions">
          <button type="button" class="btn primary" disabled={busy !== null || !draft.name?.trim()} onclick={() => save('preferred')}><Icon name="check" size={22} /> Retenir ce produit</button>
          {#if choice?.preferred && choice.preferred.id !== draft.id}
            <button type="button" class="btn" disabled={busy !== null || !draft.name?.trim()} onclick={() => save('fallback')}>En secours</button>
            {#if missing.active}
              <button type="button" class="btn" disabled={busy !== null || !draft.name?.trim()} onclick={() => save('fallback', true)}>Remplacer pour ce panier</button>
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

{#snippet productCard(product: DriveProduct, preferred: boolean)}
  <div class="product" class:fallback={!preferred}>
    <div class="what">
      <span class="role">{preferred ? 'Retenu' : missing.replacement?.id === product.id ? 'Remplace pour ce panier' : 'Secours'}</span>
      <strong>{product.name}</strong>
      <span class="muted small">
        {packLabel(product)}{product.ean ? ` · EAN ${product.ean}` : ''}
        {#if preferred && packsPreview(item, product.packText, product.pieces)} · {packsPreview(item, product.packText, product.pieces)}{/if}
      </span>
      {#if preferred && piecesUnit(item, product)}
        {#key product.id}
          <DrivePieces {api} itemKey={key} {product} unit={piecesUnit(item, product)!} {readOnly} {onChanged} />
        {/key}
      {/if}
      {#if missingTrace(product)}<span class="warn-text small">{missingTrace(product)}</span>{/if}
      <a href={product.url} target="_blank" rel="noreferrer noopener" class="small">Voir la fiche</a>
    </div>
    {#if !readOnly}
      <div class="product-actions">
        {#if !preferred && missing.proposals.includes(product)}
          <button type="button" class="btn small primary" disabled={busy !== null} onclick={() => replaceWith(product.id)}>Remplacer pour ce panier</button>
        {:else if !preferred && missing.replacement?.id === product.id}
          <button type="button" class="btn small" disabled={busy !== null} onclick={() => replaceWith(null)}>Annuler le remplacement</button>
        {/if}
        {#if !preferred}<button type="button" class="btn small" disabled={busy !== null} onclick={() => promote(product)}>{missing.active ? 'Le retenir à la place' : 'Prendre celui-ci'}</button>{/if}
        <button type="button" class="icon" aria-label="Retirer {product.name}" disabled={busy !== null} onclick={() => forget(product.id)}><Icon name="trash" size={22} /></button>
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .drive {
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

  .block,
  .draft {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .draft {
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .draft.refused {
    background: var(--warn-bg);
  }

  label {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  input {
    min-height: 52px;
    padding: 0 16px;
    border: 2px solid var(--surface-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, 1.1rem);
    user-select: text;
  }

  .muted {
    color: var(--fg-muted);
  }

  .small {
    font-size: var(--text-small);
  }

  .error {
    color: var(--danger-fg);
  }

  .notice {
    padding: 12px 16px;
    border-radius: var(--radius-md);
    background: var(--warn-bg);
    color: var(--sun);
  }

  .ok-text {
    color: var(--ok-fg);
  }

  .warn-text {
    color: var(--sun);
  }

  .packs strong {
    color: var(--rain-soft);
  }

  .actions,
  .hints {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .product {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: 14px 16px;
    border-radius: var(--radius-md);
    background: var(--rain-bg);
  }

  .product.fallback {
    background: var(--surface-2);
  }

  .product.fallback .btn:not(.primary) {
    background: var(--border-strong);
  }

  .what {
    display: flex;
    flex: 1 1 220px;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .role {
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  a {
    color: var(--rain-soft);
    font-weight: 600;
  }

  .product-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
  }

  .icon {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--fg-muted);
  }
</style>
