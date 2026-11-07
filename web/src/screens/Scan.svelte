<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { normalizeProductCode, PRODUCT_FORMATS, validProductCode } from '../../../shared/barcode.ts';
  import type { Container, Product, StockMovementResult } from '../../../shared/types.ts';
  import BackButton from '../components/BackButton.svelte';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/stock/Modal.svelte';
  import ProductForm from '../components/stock/ProductForm.svelte';
  import ProductSheet from '../components/stock/ProductSheet.svelte';
  import ShopPrompt from '../components/stock/ShopPrompt.svelte';
  import { type BeepKind, beep, unlockAudio } from '../lib/beep.ts';
  import { getAppContext } from '../lib/context.ts';
  import { cameraError } from '../lib/face.ts';
  import { type PageRoute, detailPath, phonePath, routePath } from '../lib/route.ts';
  import { createReadGate } from '../lib/scan-gate.ts';
  import { productDetail, stockText } from '../lib/stock.ts';

  // Scanner du stock (tablette : bouton Scanner ; téléphone : onglet Courses). Deux modes : « Ranger les courses »
  // (entrées) et « Jeté / épuisé » (sorties). À chaque code lu : un bip, un éclair, et le scanner attend qu'on retire
  // le produit avant d'en lire un autre (lib/scan-gate.ts) : pas de double comptage. Chaque mouvement s'annule.
  // `back` : page de la tablette à laquelle revenir ; null sur le téléphone.
  type Props = { back: PageRoute | null };
  let { back }: Props = $props();

  type Detected = { rawValue: string; format: string };
  type Detector = { detect(source: HTMLVideoElement): Promise<Detected[]> };
  type DetectorClass = { new (options?: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> };
  const DetectorApi = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

  type Mode = 'in' | 'out';
  type Facing = 'user' | 'environment';
  /** Bandeau du dernier code lu : nom, marque et contenance (`info`), puis ce qui s'est passé (`detail`). */
  type Flash = { tone: BeepKind; title: string; detail: string; info: string };
  type Entry = {
    id: string;
    kind: 'in' | 'out' | 'refill' | 'empty';
    code: string;
    product: Product | null;
    title: string;
    line: string;
    undone: boolean;
  };
  type Dialog =
    | { kind: 'unknown'; code: string; suggestion: { brand?: string | null; quantity?: string | null } | null; baseError: boolean }
    | { kind: 'out-choice'; product: Product; container: Container }
    | { kind: 'forgotten'; product: Product; remaining: number }
    | { kind: 'shop'; code: string; label: string }
    | { kind: 'sheet'; product: Product }
    | { kind: 'pick-container'; entry: Entry; name: string };

  const DETECT_EVERY_MS = 150;
  /** Tablette : sans lecture ni toucher pendant ce temps, retour à la page d'origine (la caméra s'éteint). */
  const IDLE_CLOSE_MS = 3 * 60_000;
  const ERROR_SHOW_MS = 5000;

  const { api, navigate, router } = getAppContext();
  /** Sur le téléphone (pas de page de la tablette où revenir) ; fixé à l'ouverture. */
  const phone = untrack(() => back === null);

  let video = $state<HTMLVideoElement>();
  let facing = $state<Facing>(phone ? 'environment' : 'user');
  let cameraState = $state<'starting' | 'on' | 'error'>('starting');
  let cameraMessage = $state('');
  let mode = $state<Mode>('in');
  let gateState = $state<'ready' | 'hold'>('ready');
  let busy = $state(false);
  let flash = $state<Flash | null>(null);
  let dialog = $state<Dialog | null>(null);
  let entries = $state<Entry[]>([]);
  let containers = $state<Container[]>([]);
  let manualCode = $state('');
  let manualError = $state<string | null>(null);
  /** Bandeau du dernier code lu : tant que le produit est devant la caméra, qu'une question est posée, ou une erreur. */
  const shown = $derived(gateState === 'hold' || dialog !== null || flash?.tone === 'error');
  let flashCount = 0;

  const gate = createReadGate();
  let stopCamera: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let lastActivity = Date.now();
  let destroyed = false;
  let generation = 0;

  async function startCamera(which: Facing) {
    stop();
    const mine = ++generation;
    facing = which;
    cameraState = 'starting';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: which, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (destroyed || !video || mine !== generation) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      video.srcObject = stream;
      await video.play();
      stopCamera = () => {
        for (const track of stream.getTracks()) track.stop();
        if (video) video.srcObject = null;
      };
      cameraState = 'on';
      if (DetectorApi) {
        const supported = await DetectorApi.getSupportedFormats().catch(() => [] as string[]);
        loop(mine, new DetectorApi({ formats: PRODUCT_FORMATS.filter((f) => supported.includes(f)) }));
      }
    } catch (err) {
      cameraState = 'error';
      const name = (err as Error)?.name;
      cameraMessage =
        name === 'NotReadableError' ? 'Caméra occupée : réessaie dans un instant'
        : phone && name === 'NotAllowedError' ? 'Caméra refusée : autorise-la dans le navigateur, ou saisis le code à la main'
        : cameraError(err);
    }
  }

  function loop(mine: number, detector: Detector) {
    const tick = async () => {
      if (destroyed || mine !== generation || !video) return;
      // Une question à l'écran : on n'écoute plus la caméra (le produit reste peut-être devant).
      if (!dialog) {
        try {
          const codes = (await detector.detect(video))
            .filter((d) => validProductCode(d.rawValue, d.format))
            .map((d) => normalizeProductCode(d.rawValue, d.format));
          const code = gate.frame(codes, performance.now());
          gateState = gate.state;
          if (code && !busy) void handle(code);
        } catch {
          // Image pas encore prête : on réessaie au tour suivant.
        }
      }
      if (mine === generation) timer = setTimeout(tick, DETECT_EVERY_MS);
    };
    void tick();
  }

  function stop() {
    clearTimeout(timer);
    stopCamera?.();
    stopCamera = null;
  }

  function show(tone: BeepKind, title: string, detail = '', info = '') {
    const id = ++flashCount;
    flash = { tone, title, detail, info };
    // Une erreur reste lisible même sans produit devant la caméra (saisie à la main, Annuler…), puis s'efface.
    if (tone === 'error') setTimeout(() => id === flashCount && (flash = null), ERROR_SHOW_MS);
  }

  /** Le produit est sans doute encore devant la caméra : il faut d'abord le retirer (sans lecteur : rien à attendre). */
  function holdGate() {
    if (cameraState !== 'on' || !DetectorApi) return;
    gate.hold(performance.now());
    gateState = gate.state;
  }

  function closeDialog() {
    dialog = null;
    holdGate();
  }

  function pushEntry(entry: Omit<Entry, 'undone'>) {
    entries = [{ ...entry, undone: false }, ...entries].slice(0, 40);
  }

  function entryOf(result: StockMovementResult, kind: Entry['kind'], code: string): Omit<Entry, 'undone'> {
    // Contenant vidé : son nom en titre, ce qu'il contenait en dessous.
    const name = (kind === 'empty' ? result.container?.name : null) ?? result.product?.current.name ?? result.container?.name ?? code;
    const lines: Record<Entry['kind'], string> = {
      in: `Rangé · ${stockText(result.quantity)}`,
      out: result.forgotten ? `Jeté · entrée oubliée, ${stockText(result.quantity).toLowerCase()}` : `Jeté · ${stockText(result.quantity)}`,
      refill: `Transvasé dans ${result.container?.name ?? 'le contenant'} · emballage jeté`,
      empty: `Contenant vidé${result.product ? ` · c’était ${result.product.current.name}, ${stockText(result.quantity).toLowerCase()}` : ''}`,
    };
    const shopping = result.shopping === 'added' ? ' · ajouté à la liste de courses' : '';
    return { id: result.movementId, kind, code, product: result.product, title: name, line: `${lines[kind]}${shopping}` };
  }

  async function handle(code: string) {
    busy = true;
    lastActivity = Date.now();
    beep('ok');
    show('ok', 'Code lu', code);
    try {
      const found = await api.scan(code);
      if (found.kind === 'container') await onContainer(found.container);
      else if (found.kind === 'unknown') {
        beep('ask');
        show('ask', 'Produit inconnu', 'Décris-le pour le garder en mémoire');
        dialog = { kind: 'unknown', code, suggestion: found.suggestion, baseError: found.baseError };
      } else await onProduct(found.product, found.quantity);
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
      pushEntry(entryOf(result, 'in', product.code));
      show('ok', name, `+1 · ${stockText(result.quantity)}`, info);
      return;
    }
    const container = product.refill ? containers.find((c) => c.id === product.refill) : undefined;
    if (container) {
      beep('ask');
      show('ask', name, 'Transvasé ou épuisé ?', info);
      dialog = { kind: 'out-choice', product, container };
    } else if (quantity === 0) {
      beep('ask');
      show('ask', name, 'Pas en stock : entrée oubliée ?', info);
      dialog = { kind: 'forgotten', product, remaining: 0 };
    } else await takeOut(product, {});
  }

  async function takeOut(product: Product, options: { refill?: string; remaining?: number }) {
    const result = await api.stockOut(product.code, options);
    pushEntry(entryOf(result, options.refill ? 'refill' : 'out', product.code));
    afterOut(result, product.current.name, productDetail(product.current));
  }

  /**
   * Réponse d'une fenêtre : la fermer, puis sortir le produit. Les valeurs sont prises avant : le `{@const d}` du
   * gabarit se relit sur `dialog`, qui vaut null une fois la fenêtre fermée.
   */
  function closeThenOut(product: Product, options: { refill?: string; remaining?: number }) {
    closeDialog();
    return act(() => takeOut(product, options));
  }

  function afterOut(result: StockMovementResult, name: string, info = '') {
    const changed = result.container;
    if (changed) containers = containers.map((c) => (c.id === changed.id ? changed : c));
    if (result.shopping === 'propose' && result.product && result.shoppingLabel) {
      beep('ask');
      show('ask', name, 'Épuisé', info);
      dialog = { kind: 'shop', code: result.product.code, label: result.shoppingLabel };
    } else {
      const detail = result.container && !result.product ? 'Contenant vide' : result.container ? `Dans ${result.container.name}` : stockText(result.quantity);
      show('ok', name, result.shopping === 'added' ? `${detail} · ajouté à la liste de courses` : detail, info);
    }
  }

  async function onContainer(container: Container) {
    if (mode === 'in') {
      beep('ask');
      show('ask', container.name, 'Étiquette de contenant : passe en mode « Jeté / épuisé » pour le déclarer vide');
      return;
    }
    const result = await api.emptyContainer(container.id);
    containers = containers.map((c) => (c.id === container.id ? (result.container ?? c) : c));
    pushEntry(entryOf(result, 'empty', container.code));
    afterOut({ ...result, container: null }, container.name);
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

  async function undo(entry: Entry) {
    lastActivity = Date.now();
    await act(async () => {
      const { quantity } = await api.undoStock(entry.id);
      entries = entries.map((e) => (e.id === entry.id ? { ...e, undone: true, line: `Annulé · ${stockText(quantity)}` } : e));
      if (entry.kind !== 'in') containers = (await api.stock()).containers;
    });
  }

  /** « C'était une recharge » : la sortie devient un transvasement dans un contenant (existant ou nouveau). */
  async function convertToRefill(entry: Entry, containerId: string | null, newName: string) {
    if (!entry.product) return;
    const product = entry.product;
    await act(async () => {
      const id = containerId ?? (await api.addContainer(newName.trim())).id;
      await api.undoStock(entry.id);
      entries = entries.map((e) => (e.id === entry.id ? { ...e, undone: true, line: 'Remplacé par un transvasement' } : e));
      containers = (await api.stock()).containers;
      closeDialog();
      await takeOut(product, { refill: id });
    });
  }

  /** Transvasé dans un contenant créé à l'instant : une sortie déjà notée (convertie) ou une sortie à faire. */
  async function refillIntoNew(entry: Entry, name: string) {
    if (entry.id) return convertToRefill(entry, null, name);
    const product = entry.product;
    if (!product) return;
    await act(async () => {
      const created = await api.addContainer(name.trim());
      containers = [...containers, created];
      closeDialog();
      await takeOut(product, { refill: created.id });
    });
  }

  function submitManual(event: SubmitEvent) {
    event.preventDefault();
    unlockAudio();
    const digits = manualCode.replace(/\D/gu, '');
    if (!validProductCode(digits)) {
      manualError = 'Code invalide : 8, 12 ou 13 chiffres, avec la clé';
      return;
    }
    manualError = null;
    manualCode = '';
    void handle(normalizeProductCode(digits));
  }

  const leave = () => navigate(back ? routePath(back) : phonePath('shopping'));

  onMount(() => {
    unlockAudio();
    void api.stock().then((data) => (containers = data.containers)).catch(() => undefined);
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
    stop();
  });

  function setMode(next: Mode) {
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
    <div class="viewer {flash && shown ? `hold ${flash.tone}` : ''}">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} playsinline muted class:mirror={facing === 'user'}></video>
      {#if cameraState !== 'on'}
        <div class="message">{cameraState === 'starting' ? 'Ouverture de la caméra…' : cameraMessage}</div>
      {:else if !DetectorApi}
        <div class="message">Ce navigateur ne lit pas les codes-barres : saisis le code à la main.</div>
      {/if}
      {#if flash && shown}
        <!-- Code lu : éclair, puis bandeau tant que le produit est devant la caméra. -->
        {#key flash}<div class="flash {flash.tone}" aria-hidden="true"></div>{/key}
        <div class="band {flash.tone}" role="status">
          <Icon name={flash.tone === 'error' ? 'alert' : flash.tone === 'ask' ? 'message' : 'check'} size={phone ? 26 : 36} strokeWidth={2.4} />
          <span class="band-text">
            <strong>{flash.title}</strong>
            {#if flash.info}<span class="band-info">{flash.info}</span>{/if}
            {#if flash.detail}<span>{flash.detail}</span>{/if}
          </span>
          {#if gateState === 'hold' && !dialog}<span class="remove">Retire le produit</span>{/if}
        </div>
      {:else}
        <div class="guide" aria-hidden="true"></div>
        <div class="hint">{mode === 'in' ? 'Présente le code-barres d’un produit à ranger' : 'Présente le code-barres du paquet vide'}</div>
      {/if}
      <button type="button" class="switch" aria-label="Changer de caméra" onclick={() => startCamera(facing === 'user' ? 'environment' : 'user')}>
        <Icon name="refresh" size={26} />
      </button>
    </div>

    <aside>
      <form class="manual" onsubmit={submitManual}>
        <input bind:value={manualCode} inputmode="numeric" maxlength="16" placeholder="Code-barres à la main" aria-label="Code-barres à la main" />
        <button type="submit" class="btn small" disabled={busy || !manualCode.trim()}>OK</button>
      </form>
      {#if manualError}<p class="error">{manualError}</p>{/if}

      <h2 class="card-label">{entries.length ? 'Ce passage' : 'Rien de scanné pour l’instant'}</h2>
      <ul class="entries">
        {#each entries as entry (entry.id)}
          <li class:undone={entry.undone}>
            <span class="kind {entry.kind}"><Icon name={entry.kind === 'in' ? 'cart' : entry.kind === 'out' ? 'trash' : 'jar'} size={22} /></span>
            <span class="entry-text">
              <strong>{entry.title}</strong>
              <span>{entry.kind !== 'empty' && entry.product && productDetail(entry.product.current) ? `${productDetail(entry.product.current)} · ` : ''}{entry.line}</span>
            </span>
            {#if !entry.undone}
              <span class="entry-actions">
                {#if entry.product}
                  <button type="button" class="btn small" onclick={() => entry.product && (dialog = { kind: 'sheet', product: entry.product })}>Ce n’est pas ça ?</button>
                {/if}
                {#if entry.kind === 'out' && entry.product}
                  <button type="button" class="btn small" onclick={() => (dialog = { kind: 'pick-container', entry, name: '' })}>Recharge ?</button>
                {/if}
                <button type="button" class="btn small" aria-label="Annuler" disabled={busy} onclick={() => undo(entry)}><Icon name="undo" size={20} /> Annuler</button>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </aside>
  </div>
</div>

{#if dialog?.kind === 'unknown'}
  {@const d = dialog}
  <Modal label="Produit inconnu" locked>
    <ProductForm
      title="Produit inconnu"
      code={d.code}
      initial={d.suggestion}
      hint={d.baseError ? 'base injoignable' : 'absent de la base'}
      submitLabel={mode === 'in' ? 'Enregistrer et ranger' : 'Enregistrer'}
      onSubmit={async (info) => {
        const product = await api.saveProduct(d.code, info);
        dialog = null;
        await act(() => onProduct(product, 0));
        if (!dialog) closeDialog();
      }}
      onCancel={closeDialog}
    />
  </Modal>
{:else if dialog?.kind === 'out-choice'}
  {@const d = dialog}
  <Modal label="Transvasé ou épuisé" locked>
    <h2>{d.product.current.name}</h2>
    <p class="dialog-text">D’habitude transvasé dans <strong>{d.container.name}</strong>.</p>
    <div class="dialog-actions">
      <button type="button" class="btn primary" disabled={busy} onclick={() => closeThenOut(d.product, { refill: d.container.id })}>
        <Icon name="jar" size={22} /> Transvasé dans {d.container.name}
      </button>
      <button type="button" class="btn" disabled={busy} onclick={() => closeThenOut(d.product, {})}>Épuisé</button>
      <button type="button" class="btn" onclick={closeDialog}>Annuler</button>
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
      <button type="button" class="btn primary" disabled={busy} onclick={() => closeThenOut(d.product, { remaining: d.remaining })}>
        {d.remaining === 0 ? 'Non, plus rien' : `Il en reste ${d.remaining}`}
      </button>
      <button type="button" class="btn" onclick={() => (dialog = { kind: 'pick-container', entry: { id: '', kind: 'out', code: d.product.code, product: d.product, title: d.product.current.name, line: '', undone: false }, name: '' })}>
        <Icon name="jar" size={22} /> C’était une recharge
      </button>
      <button type="button" class="btn" onclick={closeDialog}>Annuler</button>
    </div>
  </Modal>
{:else if dialog?.kind === 'shop'}
  {@const d = dialog}
  <Modal label="Liste de courses" locked>
    <ShopPrompt
      code={d.code}
      label={d.label}
      onDone={(added) => {
        if (added) entries = entries.map((e, i) => (i === 0 ? { ...e, line: `${e.line} · ajouté à la liste de courses` } : e));
        show('ok', d.label, added ? 'Ajouté à la liste de courses' : 'Épuisé');
        closeDialog();
      }}
    />
  </Modal>
{:else if dialog?.kind === 'sheet'}
  {@const d = dialog}
  <Modal label="Fiche du produit" onClose={closeDialog} wide>
    <ProductSheet
      product={d.product}
      quantity={null}
      {containers}
      onChange={(product) => {
        dialog = { kind: 'sheet', product };
        entries = entries.map((e) => (e.code === product.code ? { ...e, product, title: product.current.name } : e));
      }}
      onClose={closeDialog}
    />
  </Modal>
{:else if dialog?.kind === 'pick-container'}
  {@const d = dialog}
  <Modal label="Transvasé dans un contenant" onClose={closeDialog}>
    <h2>Transvasé dans…</h2>
    <p class="dialog-text">L’emballage de {d.entry.title} est jeté, mais le produit reste dans un contenant de la maison.</p>
    <div class="dialog-actions">
      {#each containers as container (container.id)}
        <button
          type="button"
          class="btn"
          disabled={busy}
          onclick={() =>
            d.entry.id
              ? convertToRefill(d.entry, container.id, '')
              : d.entry.product && closeThenOut(d.entry.product, { refill: container.id })}
        >
          <Icon name="jar" size={22} /> {container.name}
        </button>
      {/each}
    </div>
    <form class="manual" onsubmit={(e) => { e.preventDefault(); if (d.name.trim()) void refillIntoNew(d.entry, d.name); }}>
      <input bind:value={d.name} maxlength="60" placeholder="Nouveau contenant (Bidon de lessive…)" aria-label="Nouveau contenant" />
      <button type="submit" class="btn small" disabled={busy || !d.name.trim()}>Créer</button>
    </form>
    <div class="dialog-actions"><button type="button" class="btn" onclick={closeDialog}>Annuler</button></div>
  </Modal>
{/if}

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

  .phone .hint,
  .phone .message {
    font-size: var(--text-label);
  }

  .viewer {
    position: relative;
    overflow: hidden;
    border: 6px solid transparent;
    border-radius: var(--radius-lg);
    background: #000;
    transition: border-color 0.15s;
  }

  /* Produit lu, à retirer : bordure de couleur qui pulse. */
  .viewer.hold {
    animation: pulse 1s ease-in-out infinite;
  }

  .viewer.hold.ok {
    border-color: var(--ok);
  }

  .viewer.hold.ask {
    border-color: var(--warn);
  }

  .viewer.hold.error {
    border-color: var(--bad);
  }

  @keyframes pulse {
    50% {
      border-color: transparent;
    }
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  video.mirror {
    transform: scaleX(-1);
  }

  .guide {
    position: absolute;
    inset: 28% 14%;
    border: 3px dashed rgb(255 255 255 / 0.7);
    border-radius: var(--radius-md);
  }

  .hint,
  .message {
    position: absolute;
    left: 50%;
    max-width: 90%;
    transform: translateX(-50%);
    padding: 10px 18px;
    border-radius: 999px;
    background: rgb(15 17 21 / 0.8);
    font-size: var(--text-body);
    text-align: center;
  }

  .hint {
    top: var(--space-2);
  }

  .message {
    top: 45%;
    border-radius: var(--radius-md);
  }

  .flash {
    position: absolute;
    inset: 0;
    animation: flash 0.45s ease-out forwards;
    pointer-events: none;
  }

  .flash.ok {
    background: var(--ok);
  }

  .flash.ask {
    background: var(--warn);
  }

  .flash.error {
    background: var(--bad);
  }

  @keyframes flash {
    from {
      opacity: 0.75;
    }
    to {
      opacity: 0;
    }
  }

  .band {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: var(--space-2);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--bg);
  }

  .band.ok {
    background: var(--ok);
  }

  .band.ask {
    background: var(--warn);
  }

  .band.error {
    background: var(--bad);
  }

  .band-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    font-size: var(--text-body);
  }

  /* Nom long : sur deux lignes au plus, plutôt que coupé à la première. */
  .band-text strong {
    display: -webkit-box;
    overflow: hidden;
    font-size: var(--text-title);
    line-height: 1.2;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .band-info {
    font-weight: 600;
  }

  /* Téléphone : texte plus petit, une information par ligne, l'invitation à retirer le produit en dessous. */
  .phone .band {
    gap: var(--space-1);
    padding: 12px var(--space-2);
  }

  .phone .band-text {
    flex-basis: 0;
    font-size: var(--text-label);
  }

  .phone .band-text strong {
    font-size: var(--text-body);
  }

  .phone .remove {
    flex-basis: 100%;
    padding: 8px 14px;
    font-size: var(--text-label);
    text-align: center;
  }

  /* L'invitation à retirer le produit : ce qui évite les doublons. */
  .remove {
    padding: 10px 18px;
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font-size: var(--text-body);
    font-weight: 700;
    animation: nudge 0.9s ease-in-out infinite;
  }

  @keyframes nudge {
    50% {
      transform: translateY(-6px);
    }
  }

  .switch {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: grid;
    width: 56px;
    height: 56px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: rgb(15 17 21 / 0.75);
    color: var(--fg);
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

  .entries {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .entries li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 6px var(--space-2);
    padding: 12px var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .entries li.undone {
    opacity: 0.5;
  }

  .kind {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 50%;
    background: var(--rain-bg);
    color: var(--rain-soft);
  }

  .kind.out {
    background: var(--warn-bg);
    color: var(--warn);
  }

  .kind.refill,
  .kind.empty {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }

  .entry-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .entry-text strong {
    overflow: hidden;
    font-size: var(--text-body);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .entry-text span {
    color: var(--fg-muted);
  }

  .entry-actions {
    display: flex;
    flex-wrap: wrap;
    grid-column: 2;
    gap: 6px;
  }

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
</style>
