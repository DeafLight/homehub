<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { Container, Product, ProductInfo, StockMovementResult } from '../../../shared/types.ts';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import ScanDialog from '../components/stock/ScanDialog.svelte';
  import ScanEntries from '../components/stock/ScanEntries.svelte';
  import ScanViewer from '../components/stock/ScanViewer.svelte';
  import { canDetectBarcodes, createBarcodeCamera } from '../lib/barcode-camera.ts';
  import { type BeepKind, beep, unlockAudio } from '../lib/beep.ts';
  import { getAppContext } from '../lib/context.ts';
  import { type PageRoute, detailPath, phonePath, routePath } from '../lib/route.ts';
  import {
    addEntry,
    afterOut,
    cameraProblem,
    entryOf,
    type Facing,
    type Flash,
    markUndone,
    noteShoppingAdded,
    readManualCode,
    refillContainer,
    renameProduct,
    type ScanDialog as Dialog,
    type ScanEntry,
    type ScanMode,
  } from '../lib/scan.ts';
  import { createReadGate } from '../lib/scan-gate.ts';
  import { productDetail, stockText } from '../lib/stock.ts';

  // Scanner du stock (tablette : bouton Scanner ; téléphone : onglet Courses). Deux modes : « Ranger les courses »
  // (entrées) et « Jeté / épuisé » (sorties). À chaque code lu : un bip, un éclair, et le scanner attend qu'on retire
  // le produit avant d'en lire un autre (lib/scan-gate.ts) : pas de double comptage. Chaque mouvement s'annule.
  // Règles du journal et des bandeaux : lib/scan.ts ; caméra : lib/barcode-camera.ts ; affichage : components/stock/Scan*.
  // `back` : page de la tablette à laquelle revenir ; null sur le téléphone.
  type Props = { back: PageRoute | null };
  let { back }: Props = $props();

  type OutOptions = { refill?: string; remaining?: number };

  /** Tablette : sans lecture ni toucher pendant ce temps, retour à la page d'origine (la caméra s'éteint). */
  const IDLE_CLOSE_MS = 3 * 60_000;
  const ERROR_SHOW_MS = 5000;

  const { api, actor, config, navigate, router } = getAppContext();
  /** Sur le téléphone (pas de page de la tablette où revenir) ; fixé à l'ouverture. */
  const phone = untrack(() => back === null);

  let video = $state<HTMLVideoElement>();
  let facing = $state<Facing>(phone ? 'environment' : 'user');
  let cameraState = $state<'starting' | 'on' | 'error'>('starting');
  let cameraMessage = $state('');
  let mode = $state<ScanMode>('in');
  let gateState = $state<'ready' | 'hold'>('ready');
  let busy = $state(false);
  let flash = $state<Flash | null>(null);
  let dialog = $state<Dialog | null>(null);
  let entries = $state<ScanEntry[]>([]);
  let containers = $state<Container[]>([]);
  let manualCode = $state('');
  let manualError = $state<string | null>(null);
  /** Téléphone : son profil (les scans sont à son nom). */
  let phoneOwner = $state<string | null>(null);
  const nameOf = (ownerId: string | null) => (ownerId ? (config.members.find((m) => m.id === ownerId)?.name ?? null) : null);
  /** Au nom de qui sont les scans : le profil du téléphone, la personne reconnue en ouvrant le scanner, ou personne. */
  const scanner = $derived(phone ? nameOf(phoneOwner) : (actor.current?.name ?? null));
  /** Bandeau du dernier code lu : tant que le produit est devant la caméra, qu'une question est posée, ou une erreur. */
  const shown = $derived(gateState === 'hold' || dialog !== null || flash?.tone === 'error');
  let flashCount = 0;

  const gate = createReadGate();
  const camera = createBarcodeCamera({
    video: () => video,
    paused: () => dialog !== null,
    onOpen: () => (cameraState = 'on'),
    onFrame: (codes) => {
      const code = gate.frame(codes, performance.now());
      gateState = gate.state;
      if (code && !busy) void handle(code);
    },
  });
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let lastActivity = Date.now();
  let destroyed = false;

  async function startCamera(which: Facing) {
    facing = which;
    cameraState = 'starting';
    try {
      await camera.start(which);
    } catch (err) {
      cameraState = 'error';
      cameraMessage = cameraProblem(err, phone);
    }
  }

  function show(tone: BeepKind, title: string, detail = '', info = '') {
    const id = ++flashCount;
    flash = { tone, title, detail, info };
    // Une erreur reste lisible même sans produit devant la caméra (saisie à la main, Annuler…), puis s'efface.
    if (tone === 'error') setTimeout(() => id === flashCount && (flash = null), ERROR_SHOW_MS);
  }

  /** Une question : deux notes, le bandeau, puis la fenêtre s'il y en a une. */
  function ask(title: string, detail: string, next: Dialog | null, info = '') {
    beep('ask');
    show('ask', title, detail, info);
    if (next) dialog = next;
  }

  /** Le produit est sans doute encore devant la caméra : il faut d'abord le retirer (sans lecteur : rien à attendre). */
  function holdGate() {
    if (cameraState !== 'on' || !canDetectBarcodes) return;
    gate.hold(performance.now());
    gateState = gate.state;
  }

  function closeDialog() {
    dialog = null;
    holdGate();
  }

  async function handle(code: string) {
    busy = true;
    lastActivity = Date.now();
    beep('ok');
    show('ok', 'Code lu', code);
    try {
      const found = await api.scan(code);
      if (found.kind === 'container') await onContainer(found.container);
      else if (found.kind === 'unknown') ask('Produit inconnu', 'Décris-le pour le garder en mémoire', { kind: 'unknown', code, suggestion: found.suggestion, baseError: found.baseError });
      else await onProduct(found.product, found.quantity);
    } catch (err) {
      beep('error');
      show('error', 'Pas enregistré', (err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function onProduct(product: Product, quantity: number) {
    const name = product.current.name;
    const info = productDetail(product.current);
    if (mode === 'in') {
      const result = await api.stockIn(product.code);
      entries = addEntry(entries, entryOf(result, 'in', product.code));
      show('ok', name, `+1 · ${stockText(result.quantity)}`, info);
      return;
    }
    const container = refillContainer(product, containers);
    if (container) ask(name, 'Transvasé ou épuisé ?', { kind: 'out-choice', product, container }, info);
    else if (quantity === 0) ask(name, 'Pas en stock : entrée oubliée ?', { kind: 'forgotten', product, remaining: 0 }, info);
    else await takeOut(product, {});
  }

  async function takeOut(product: Product, options: OutOptions) {
    const result = await api.stockOut(product.code, options);
    entries = addEntry(entries, entryOf(result, options.refill ? 'refill' : 'out', product.code));
    finishOut(result, product.current.name, productDetail(product.current));
  }

  /** Réponse d'une fenêtre : la fermer, puis sortir le produit (valeurs reçues en arguments, pas relues sur `dialog`). */
  function closeThenOut(product: Product, options: OutOptions) {
    closeDialog();
    return act(() => takeOut(product, options));
  }

  function finishOut(result: StockMovementResult, name: string, info = '') {
    const changed = result.container;
    if (changed) containers = containers.map((c) => (c.id === changed.id ? changed : c));
    const next = afterOut(result, name, info);
    if (next.dialog) ask(next.flash.title, next.flash.detail, next.dialog, next.flash.info);
    else show(next.flash.tone, next.flash.title, next.flash.detail, next.flash.info);
  }

  async function onContainer(container: Container) {
    if (mode === 'in') return ask(container.name, 'Étiquette de contenant : passe en mode « Jeté / épuisé » pour le déclarer vide', null);
    const result = await api.emptyContainer(container.id);
    containers = containers.map((c) => (c.id === container.id ? (result.container ?? c) : c));
    entries = addEntry(entries, entryOf(result, 'empty', container.code));
    finishOut({ ...result, container: null }, container.name);
  }

  async function act(action: () => Promise<void>) {
    busy = true;
    try {
      await action();
    } catch (err) {
      beep('error');
      show('error', 'Pas enregistré', (err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function undo(entry: ScanEntry) {
    lastActivity = Date.now();
    await act(async () => {
      const { quantity } = await api.undoStock(entry.id);
      entries = markUndone(entries, entry.id, `Annulé · ${stockText(quantity)}`);
      if (entry.kind !== 'in') containers = (await api.stock()).containers;
    });
  }

  /**
   * Transvasé dans un contenant (existant, ou créé à l'instant) : une sortie déjà notée devient un transvasement
   * (annulée puis refaite), une sortie pas encore faite (`entry.id` vide) se fait directement dans le contenant.
   */
  async function refill(entry: ScanEntry, target: { containerId: string } | { name: string }) {
    const product = entry.product;
    if (!product) return;
    await act(async () => {
      let id: string;
      if ('containerId' in target) id = target.containerId;
      else {
        const created = await api.addContainer(target.name.trim());
        if (!entry.id) containers = [...containers, created];
        id = created.id;
      }
      if (entry.id) {
        await api.undoStock(entry.id);
        entries = markUndone(entries, entry.id, 'Remplacé par un transvasement');
        containers = (await api.stock()).containers;
      }
      closeDialog();
      await takeOut(product, { refill: id });
    });
  }

  /** Produit inconnu décrit : enregistré, puis traité comme s'il venait d'être lu (jamais en stock). */
  async function describe(code: string, info: ProductInfo) {
    const product = await api.saveProduct(code, info);
    dialog = null;
    await act(() => onProduct(product, 0));
    if (!dialog) closeDialog();
  }

  function submitManual(event: SubmitEvent) {
    event.preventDefault();
    unlockAudio();
    const read = readManualCode(manualCode);
    if ('error' in read) {
      manualError = read.error;
      return;
    }
    manualError = null;
    manualCode = '';
    void handle(read.code);
  }

  const leave = () => navigate(back ? routePath(back) : phonePath('shopping'));

  onMount(() => {
    unlockAudio();
    void api.stock().then((data) => (containers = data.containers)).catch(() => undefined);
    if (phone) void api.me().then((me) => (phoneOwner = me.device?.ownerId ?? null)).catch(() => undefined);
    // La reconnaissance des visages vient de s'éteindre (Presence.svelte) : on lui laisse rendre la caméra.
    setTimeout(() => !destroyed && void startCamera(facing), 300);
    if (!phone) {
      const touched = () => (lastActivity = Date.now());
      window.addEventListener('pointerdown', touched);
      idleTimer = setInterval(() => {
        if (Date.now() - lastActivity > IDLE_CLOSE_MS && !dialog && !busy) leave();
      }, 15_000);
      return () => window.removeEventListener('pointerdown', touched);
    }
  });

  onDestroy(() => {
    destroyed = true;
    clearInterval(idleTimer);
    camera.stop();
  });

  function setMode(next: ScanMode) {
    unlockAudio();
    mode = next;
    flash = null;
  }
</script>

<div class="scan" class:phone>
  <header>
    {#if back}
      <BackButton {back} />
    {:else}
      <button type="button" class="btn" onclick={leave}><Icon name="back" size={24} /> Courses</button>
    {/if}
    <div class="modes" role="radiogroup" aria-label="Mode du scanner">
      <button type="button" role="radio" aria-checked={mode === 'in'} class:on={mode === 'in'} onclick={() => setMode('in')}>
        <Icon name="cart" size={26} /> {phone ? 'Ranger' : 'Ranger les courses'}
      </button>
      <button type="button" role="radio" aria-checked={mode === 'out'} class:on={mode === 'out'} class:out={mode === 'out'} onclick={() => setMode('out')}>
        <Icon name="trash" size={26} /> Jeté / épuisé
      </button>
    </div>
    {#if back}
      <button type="button" class="btn" onclick={() => navigate(detailPath('stock', router.route))}><Icon name="box" size={24} /> Stock</button>
    {/if}
  </header>

  <div class="layout">
    <ScanViewer
      bind:video
      {facing}
      {cameraState}
      {cameraMessage}
      flash={shown ? flash : null}
      remove={gateState === 'hold' && !dialog}
      {mode}
      {phone}
      onSwitch={() => startCamera(facing === 'user' ? 'environment' : 'user')}
    />

    <aside>
      <form class="manual" onsubmit={submitManual}>
        <input bind:value={manualCode} inputmode="numeric" maxlength="16" placeholder="Code-barres à la main" aria-label="Code-barres à la main" />
        <button type="submit" class="btn small" disabled={busy || !manualCode.trim()}>OK</button>
      </form>
      {#if manualError}<p class="error">{manualError}</p>{/if}

      <p class="who">
        <Icon name="face" size={20} />
        {#if scanner}
          <span>Scans au nom de <strong>{scanner}</strong></span>
          {#if !phone}<button type="button" class="link" onclick={() => actor.end()}>Pas moi</button>{/if}
        {:else}
          <span>{phone ? 'Scans anonymes' : 'Personne de reconnu : scans anonymes'}</span>
        {/if}
      </p>

      <h2 class="card-label">{entries.length ? 'Ce passage' : 'Rien de scanné pour l’instant'}</h2>
      <ScanEntries
        {entries}
        {busy}
        {nameOf}
        onSheet={(product) => (dialog = { kind: 'sheet', product })}
        onRefill={(entry) => (dialog = { kind: 'pick-container', entry, name: '' })}
        onUndo={undo}
      />
    </aside>
  </div>
</div>

<ScanDialog
  bind:dialog
  {mode}
  {busy}
  {containers}
  onClose={closeDialog}
  onOut={closeThenOut}
  onDescribe={describe}
  onShopDone={(label, added) => {
    if (added) entries = noteShoppingAdded(entries);
    show('ok', label, added ? 'Ajouté à la liste de courses' : 'Épuisé');
    closeDialog();
  }}
  onSheetChange={(product) => {
    dialog = { kind: 'sheet', product };
    entries = renameProduct(entries, product);
  }}
  onRefill={refill}
/>

<style>
  .scan {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 100dvh;
    padding: var(--space-3) var(--space-4);
    box-sizing: border-box;
  }

  .scan.phone {
    padding: calc(var(--space-2) + env(safe-area-inset-top)) var(--space-2) var(--space-2);
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .modes {
    display: flex;
    flex: 1;
    justify-content: center;
    gap: 4px;
    padding: 4px;
    border-radius: 999px;
    background: var(--surface);
  }

  .modes button {
    display: inline-flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    max-width: 320px;
    min-height: 60px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-size: var(--text-body);
    font-weight: 600;
  }

  .modes button.on {
    background: var(--rain);
    color: var(--bg);
  }

  .modes button.on.out {
    background: var(--warn);
  }

  .layout {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
  }

  .phone .layout {
    grid-template-columns: 1fr;
    grid-template-rows: 46dvh minmax(0, 1fr);
    gap: var(--space-2);
  }

  /* Téléphone : les deux modes sur leur propre ligne, sous le bouton de retour. */
  .phone header {
    flex-wrap: wrap;
  }

  .phone .modes {
    flex-basis: 100%;
  }

  .phone .modes button {
    min-height: 52px;
    font-size: 1rem;
  }

  aside {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
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

  .error {
    margin: 0;
    color: var(--danger-fg);
  }

  .who {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--fg-muted);
  }

  .who strong {
    color: var(--fg);
  }

  .link {
    padding: 4px 8px;
    border: 0;
    background: none;
    color: var(--rain-soft);
    font: inherit;
    text-decoration: underline;
  }

  h2 {
    margin: 0;
    font-size: var(--text-title);
  }
</style>
