<script lang="ts">
  import type { Container, Product, ProductInfo } from '../../../../shared/types.ts';
  import { pendingEntry, type ScanDialog, type ScanEntry, type ScanMode } from '../../lib/scan.ts';
  import Icon from '../Icon.svelte';
  import Modal from './Modal.svelte';
  import ProductForm from './ProductForm.svelte';
  import ProductSheet from './ProductSheet.svelte';
  import ShopPrompt from './ShopPrompt.svelte';

  // Questions du scanner, une à la fois : produit inconnu à décrire, transvasé ou épuisé, entrée oubliée, liste de
  // courses, fiche du produit, contenant où il a été transvasé. Les réponses remontent à Scan.svelte, qui parle au
  // serveur ; seuls les champs de la question (nombre restant, nom d'un nouveau contenant) se modifient ici.
  type OutOptions = { refill?: string; remaining?: number };
  type Props = {
    /** Question ouverte (rien si null). */
    dialog: ScanDialog | null;
    mode: ScanMode;
    busy: boolean;
    containers: Container[];
    onClose: () => void;
    /** Fermer la question, puis sortir le produit. */
    onOut: (product: Product, options: OutOptions) => void;
    /** Produit inconnu décrit : l'enregistrer, puis continuer comme s'il venait d'être lu. */
    onDescribe: (code: string, info: ProductInfo) => Promise<void>;
    onShopDone: (label: string, added: boolean) => void;
    onSheetChange: (product: Product) => void;
    /** Transvasé dans un contenant existant (`containerId`) ou à créer (`name`). */
    onRefill: (entry: ScanEntry, target: { containerId: string } | { name: string }) => void;
  };
  let { dialog = $bindable(), mode, busy, containers, onClose, onOut, onDescribe, onShopDone, onSheetChange, onRefill }: Props = $props();

  function pickContainer(entry: ScanEntry, container: Container) {
    if (entry.id) onRefill(entry, { containerId: container.id });
    else if (entry.product) onOut(entry.product, { refill: container.id });
  }
</script>

{#if dialog?.kind === 'unknown'}
  {@const d = dialog}
  <Modal label="Produit inconnu" locked>
    <ProductForm
      title="Produit inconnu"
      code={d.code}
      initial={d.suggestion}
      hint={d.baseError ? 'base injoignable' : 'absent de la base'}
      submitLabel={mode === 'in' ? 'Enregistrer et ranger' : 'Enregistrer'}
      onSubmit={(info) => onDescribe(d.code, info)}
      onCancel={onClose}
    />
  </Modal>
{:else if dialog?.kind === 'out-choice'}
  {@const d = dialog}
  <Modal label="Transvasé ou épuisé" locked>
    <h2>{d.product.current.name}</h2>
    <p class="dialog-text">D’habitude transvasé dans <strong>{d.container.name}</strong>.</p>
    <div class="dialog-actions">
      <button type="button" class="btn primary" disabled={busy} onclick={() => onOut(d.product, { refill: d.container.id })}>
        <Icon name="jar" size={22} /> Transvasé dans {d.container.name}
      </button>
      <button type="button" class="btn" disabled={busy} onclick={() => onOut(d.product, {})}>Épuisé</button>
      <button type="button" class="btn" onclick={onClose}>Annuler</button>
    </div>
  </Modal>
{:else if dialog?.kind === 'forgotten'}
  {@const d = dialog}
  <Modal label="Entrée oubliée" locked>
    <h2>{d.product.current.name}</h2>
    <p class="dialog-text">Il n’était pas en stock : l’entrée a dû être oubliée. Il en reste à la maison ?</p>
    <div class="stepper">
      <button type="button" class="btn" aria-label="Un de moins" disabled={d.remaining === 0} onclick={() => (d.remaining -= 1)}><Icon name="minus" size={24} /></button>
      <span class="count">{d.remaining}</span>
      <button type="button" class="btn" aria-label="Un de plus" onclick={() => (d.remaining += 1)}><Icon name="plus" size={24} /></button>
    </div>
    <div class="dialog-actions">
      <button type="button" class="btn primary" disabled={busy} onclick={() => onOut(d.product, { remaining: d.remaining })}>
        {d.remaining === 0 ? 'Non, plus rien' : `Il en reste ${d.remaining}`}
      </button>
      <button type="button" class="btn" onclick={() => (dialog = { kind: 'pick-container', entry: pendingEntry(d.product), name: '' })}>
        <Icon name="jar" size={22} /> C’était une recharge
      </button>
      <button type="button" class="btn" onclick={onClose}>Annuler</button>
    </div>
  </Modal>
{:else if dialog?.kind === 'shop'}
  {@const d = dialog}
  <Modal label="Liste de courses" locked>
    <ShopPrompt code={d.code} label={d.label} onDone={(added) => onShopDone(d.label, added)} />
  </Modal>
{:else if dialog?.kind === 'sheet'}
  {@const d = dialog}
  <Modal label="Fiche du produit" {onClose} wide>
    <ProductSheet product={d.product} quantity={null} {containers} onChange={onSheetChange} {onClose} />
  </Modal>
{:else if dialog?.kind === 'pick-container'}
  {@const d = dialog}
  <Modal label="Transvasé dans un contenant" {onClose}>
    <h2>Transvasé dans…</h2>
    <p class="dialog-text">L’emballage de {d.entry.title} est jeté, mais le produit reste dans un contenant de la maison.</p>
    <div class="dialog-actions">
      {#each containers as container (container.id)}
        <button type="button" class="btn" disabled={busy} onclick={() => pickContainer(d.entry, container)}>
          <Icon name="jar" size={22} /> {container.name}
        </button>
      {/each}
    </div>
    <form
      class="manual"
      onsubmit={(e) => {
        e.preventDefault();
        if (d.name.trim()) onRefill(d.entry, { name: d.name });
      }}
    >
      <input bind:value={d.name} maxlength="60" placeholder="Nouveau contenant (Bidon de lessive…)" aria-label="Nouveau contenant" />
      <button type="submit" class="btn small" disabled={busy || !d.name.trim()}>Créer</button>
    </form>
    <div class="dialog-actions"><button type="button" class="btn" onclick={onClose}>Annuler</button></div>
  </Modal>
{/if}

<style>
  h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  .dialog-text {
    margin: 0;
    color: var(--fg-soft);
    font-size: var(--text-body);
  }

  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .stepper {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
  }

  .count {
    min-width: 2ch;
    font-size: var(--text-display);
    font-weight: 600;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .manual {
    display: flex;
    gap: var(--space-1);
  }

  .manual input {
    flex: 1;
    min-width: 0;
    min-height: 52px;
    padding: 0 16px;
    border: 2px solid var(--surface-2);
    border-radius: 999px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, var(--text-body));
  }
</style>
