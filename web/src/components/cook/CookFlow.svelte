<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CookResult } from '../../../../shared/cook.ts';
  import { getAppContext } from '../../lib/context.ts';
  import { type CookTarget, resultText, returnedText, shoppingQuestion, undoText } from '../../lib/cook.ts';
  import Icon from '../Icon.svelte';
  import Modal from '../stock/Modal.svelte';
  import CookPanel from './CookPanel.svelte';

  // « J'ai cuisiné » de bout en bout, posé sur une page (menu, fiche, mode cuisine) : le panneau, puis le bandeau
  // « Retiré du stock : … · Annuler » (et les coches « j'en ai déjà » revenues dans les courses), puis, pour les produits
  // épuisés, la proposition de liste de courses habituelle, regroupée (Oui · Oui, et toujours d'office · Non).
  type Props = {
    /** Ce qu'ouvre le panneau ; null : fermé. */
    target: CookTarget | null;
    phone?: boolean;
    /** Le panneau est fermé (avec ou sans décompte). */
    onClose: (result: CookResult | null) => void;
    /** Quelque chose a changé (décompte, annulation, liste de courses) : relire la page. */
    onChanged?: () => void;
    onLink?: () => void;
  };
  let { target, phone = false, onClose, onChanged, onLink }: Props = $props();

  const { api } = getAppContext();
  const BANNER_MS = 20_000;

  let banner = $state<{ result: CookResult; text: string; extra: string[]; undone: boolean } | null>(null);
  let shop = $state<CookResult['propose']>([]);
  let busy = $state(false);
  let shopError = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(timer));

  function showBanner(result: CookResult) {
    const extra = [...returnedText(result.returned), ...(result.added.length ? [`Ajouté à la liste de courses : ${result.added.join(', ').toLowerCase()}`] : [])];
    banner = { result, text: resultText(result), extra, undone: false };
    clearTimeout(timer);
    timer = setTimeout(() => (banner = null), BANNER_MS);
  }

  function done(result: CookResult | null) {
    onClose(result);
    if (!result) return;
    showBanner(result);
    shop = result.propose;
    onChanged?.();
  }

  async function undo() {
    if (!banner || busy) return;
    busy = true;
    try {
      const undone = await api.undoCook(banner.result.cook);
      banner = { ...banner, text: undoText(undone), extra: [], undone: true };
      shop = [];
      clearTimeout(timer);
      timer = setTimeout(() => (banner = null), 6000);
      onChanged?.();
    } catch (err) {
      banner = { ...banner, text: (err as Error).message, extra: [] };
    } finally {
      busy = false;
    }
  }

  async function addToList(always: boolean) {
    busy = true;
    shopError = null;
    try {
      for (const p of shop) await api.shopProduct(p.code, always);
      shop = [];
      onChanged?.();
    } catch (err) {
      shopError = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

{#if target}
  <CookPanel {target} {phone} onDone={done} {onLink} />
{/if}

{#if shop.length && !target}
  <Modal label="Liste de courses" locked>
    <h2 class="question">{shoppingQuestion(shop.map((p) => p.label))}</h2>
    {#if shopError}<p class="error">{shopError}</p>{/if}
    <div class="actions">
      <button type="button" class="btn primary" disabled={busy} onclick={() => addToList(false)}>Oui</button>
      <button type="button" class="btn" disabled={busy} onclick={() => addToList(true)}>Oui, et toujours d’office</button>
      <button type="button" class="btn" disabled={busy} onclick={() => (shop = [])}>Non</button>
    </div>
  </Modal>
{/if}

{#if banner && !target}
  <div class="banner" class:phone role="status">
    <div class="text">
      <span>{banner.text}</span>
      {#each banner.extra as line (line)}<span class="extra">{line}</span>{/each}
    </div>
    {#if !banner.undone}
      <button type="button" class="btn small" disabled={busy} onclick={undo}><Icon name="undo" size={22} /> Annuler</button>
    {/if}
    <button type="button" class="close" aria-label="Fermer le bandeau" onclick={() => (banner = null)}><Icon name="close" size={20} /></button>
  </div>
{/if}

<style>
  .question {
    margin: 0;
    font-size: var(--text-title);
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  /* Bandeau « Annuler », en bas au centre, au-dessus de la page (comme pour un repas retiré du menu). */
  .banner {
    position: fixed;
    left: 50%;
    bottom: calc(var(--space-3) + env(safe-area-inset-bottom));
    z-index: 35;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    max-width: calc(100% - 32px);
    box-sizing: border-box;
    padding: 8px 8px 8px var(--space-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    color: var(--fg);
    font-size: var(--text-small);
    transform: translateX(-50%);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .extra {
    color: var(--rain-soft);
  }

  .banner .btn {
    flex-shrink: 0;
  }

  .close {
    display: grid;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--fg-muted);
  }

  .banner.phone {
    width: calc(100% - 32px);
  }
</style>
