<script lang="ts">
  import { onDestroy } from 'svelte';
  import { REMOTE_TEXT_MAX, type RemoteKey, type RemoteScreen } from '../../../shared/screen.ts';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import { loadPairing } from '../lib/phone.ts';
  import { appsDate, capabilities, controlHint, createKeyQueue, statusLine } from '../lib/remote.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { phonePath } from '../lib/route.ts';

  // Télécommande de la télé sur le téléphone d'un parent (/m/tele, fonction 17). En-tête : nom et état de la télé
  // (allumée, en veille, injoignable) et bouton marche/arrêt (une télé injoignable s'allume par Cast). Onglet Touches :
  // pavé de flèches avec OK au centre, Retour, Accueil, lecture/pause, volume, muet, clavier (texte écrit dans le champ
  // qui a le focus sur la télé) et « À table ! » (pause et bandeau). Onglet Applis : l'appli en cours et le tiroir des
  // applis de la télé, à lancer d'un geste. Le serveur vérifie les droits (parents) ; règles : lib/remote.ts.
  const STATE_REFRESH_MS = 5_000;
  /** La liste des applis se recharge surtout quand la télé en envoie une nouvelle (date de la liste). */
  const APPS_REFRESH_MS = 10 * 60_000;

  const { api, config, clock, navigate } = getAppContext();
  const pairing = loadPairing();
  const member = config.members.find((m) => m.id === pairing?.ownerId);

  const screens = createResource(() => api.remoteScreens(), STATE_REFRESH_MS);
  let chosenId = $state<string | null>(null);
  const screen = $derived<RemoteScreen | undefined>(screens.data?.find((s) => s.id === chosenId) ?? screens.data?.[0]);
  const can = $derived(screen ? capabilities(screen) : { keys: false, basic: false, apps: false });
  const hint = $derived(screen ? controlHint(screen) : null);

  let tab = $state<'keys' | 'apps'>('keys');
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let text = $state('');
  let busy = $state(false);

  // Tiroir des applis : rechargé quand la télé envoie une nouvelle liste.
  const apps = createResource(async () => (screen ? api.remoteApps(screen.id) : null), APPS_REFRESH_MS);
  let appsAt: string | null | undefined;
  $effect(() => {
    if (screen && screen.appsAt !== appsAt) {
      appsAt = screen.appsAt;
      void apps.refresh();
    }
  });
  onDestroy(() => {
    screens.destroy();
    apps.destroy();
  });

  const fail = (err: unknown) => {
    error = (err as Error).message;
    notice = null;
  };
  const buzz = () => navigator.vibrate?.(12);

  const keyQueue = createKeyQueue(
    (keys) => (screen ? api.remoteKeys(screen.id, keys) : Promise.resolve()),
    fail,
    () => (error = null),
  );
  function press(key: RemoteKey) {
    buzz();
    keyQueue.press(key);
  }

  /** Un ordre de la télécommande (texte, appli, « À table ! », marche/arrêt), puis l'état relu. */
  async function run(action: () => Promise<string | null>) {
    if (busy) return;
    busy = true;
    error = null;
    buzz();
    try {
      notice = await action();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) navigate(phonePath('shopping'));
      fail(err);
    } finally {
      busy = false;
      void screens.refresh();
    }
  }

  const togglePower = () =>
    run(async () => {
      if (!screen) return null;
      const on = screen.power !== 'on';
      const result = await api.remotePower(screen.id, on);
      if (!on) return 'Télé mise en veille';
      return result.via === 'cast' ? 'Allumage par Cast : la télé se réveille…' : 'Télé allumée';
    });

  const sendText = (event: SubmitEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || !screen) return;
    void run(async () => {
      await api.remoteText(screen.id, value, true);
      text = '';
      return `« ${value} » écrit sur la télé`;
    });
  };

  const dinner = () => run(async () => (screen ? (await api.remoteDinner(screen.id), 'À table ! Pause et bandeau sur la télé') : null));
  const launch = (pkg: string, name: string) => run(async () => (screen ? (await api.remoteLaunch(screen.id, pkg), `${name} s’ouvre sur la télé`) : null));

  const ARROWS: { key: RemoteKey; label: string; cls: string }[] = [
    { key: 'up', label: 'Haut', cls: 'up' },
    { key: 'left', label: 'Gauche', cls: 'left' },
    { key: 'right', label: 'Droite', cls: 'right' },
    { key: 'down', label: 'Bas', cls: 'down' },
  ];
  const NAV: { key: RemoteKey; label: string; icon: IconName }[] = [
    { key: 'back', label: 'Retour', icon: 'back' },
    { key: 'home', label: 'Accueil', icon: 'home' },
    { key: 'playpause', label: 'Lecture / pause', icon: 'playPause' },
  ];
</script>

<div class="remote">
  <header>
    <button type="button" class="back" aria-label="Retour à l’appli" onclick={() => navigate(phonePath('shopping'))}><Icon name="back" size={28} strokeWidth={2.2} /></button>
    <div class="title">
      <h1>Télécommande</h1>
      {#if screen}
        <span class="status {screen.power}"><span class="dot"></span>{statusLine(screen)}</span>
      {/if}
    </div>
    {#if screen}
      <button
        type="button"
        class="power"
        class:on={screen.power === 'on'}
        aria-label={screen.power === 'on' ? 'Mettre la télé en veille' : 'Allumer la télé'}
        disabled={busy || (screen.power === 'offline' && !screen.canWake)}
        onclick={togglePower}
      >
        <Icon name="power" size={28} strokeWidth={2.4} />
      </button>
    {/if}
  </header>

  {#if !member?.parent}
    <p class="muted">La télécommande est réservée aux parents.</p>
  {:else if screens.error && !screens.data}
    <p class="error">{screens.error}</p>
  {:else if screens.data && screens.data.length === 0}
    <p class="muted">Aucune télé appairée. Sur la tablette : roue dentée › Téléphones › Télés.</p>
  {:else if screen}
    {#if screens.data && screens.data.length > 1}
      <div class="pills screens">
        {#each screens.data as s (s.id)}
          <button type="button" class:on={s.id === screen.id} onclick={() => (chosenId = s.id)}>{s.name}</button>
        {/each}
      </div>
    {/if}

    <div class="pills" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'keys'} class:on={tab === 'keys'} onclick={() => (tab = 'keys')}><Icon name="keyboard" size={20} /> Touches</button>
      <button type="button" role="tab" aria-selected={tab === 'apps'} class:on={tab === 'apps'} onclick={() => (tab = 'apps')}><Icon name="grid" size={20} /> Applis</button>
    </div>

    {#if hint}<p class="hint">{hint}</p>{/if}
    <p class="feedback" role="status" class:error={error !== null} class:quiet={!(error ?? notice)}>{error ?? notice ?? ''}</p>

    {#if tab === 'keys'}
      <div class="pad" aria-label="Flèches">
        {#each ARROWS as arrow (arrow.key)}
          <button type="button" class="arrow {arrow.cls}" aria-label={arrow.label} disabled={!can.keys} onclick={() => press(arrow.key)}><Icon name="chevron" size={34} strokeWidth={2.6} /></button>
        {/each}
        <button type="button" class="ok" disabled={!can.keys} onclick={() => press('ok')}>OK</button>
      </div>

      <div class="row">
        {#each NAV as item (item.key)}
          <button type="button" class="key" aria-label={item.label} disabled={!can.basic} onclick={() => press(item.key)}><Icon name={item.icon} size={26} /></button>
        {/each}
      </div>
      <div class="row">
        <button type="button" class="key" aria-label="Baisser le volume" disabled={!can.basic} onclick={() => press('voldown')}><Icon name="volume" size={24} /><span class="sign">−</span></button>
        <button type="button" class="key" aria-label="Couper le son" disabled={!can.basic} onclick={() => press('mute')}><Icon name="mute" size={24} /></button>
        <button type="button" class="key" aria-label="Monter le volume" disabled={!can.basic} onclick={() => press('volup')}><Icon name="volume" size={24} /><span class="sign">+</span></button>
      </div>

      <h2>Clavier</h2>
      <form class="typing" onsubmit={sendText}>
        <input
          type="search"
          bind:value={text}
          maxlength={REMOTE_TEXT_MAX}
          placeholder="Chercher sur la télé"
          aria-label="Texte à écrire sur la télé"
          enterkeyhint="search"
          autocomplete="off"
          disabled={!can.keys}
        />
        <button type="submit" class="send" aria-label="Écrire sur la télé" disabled={!can.keys || busy || !text.trim()}><Icon name="send" size={24} /></button>
      </form>
      <p class="muted small">Le texte s’écrit dans le champ de recherche ouvert sur la télé, puis la recherche se lance.</p>

      <button type="button" class="btn wide dinner" disabled={!can.basic || busy} onclick={dinner}>À table !</button>
    {:else}
      <h2>En cours</h2>
      {#if screen.foreground}
        {@const current = apps.data?.apps.find((a) => a.package === screen.foreground?.package)}
        <div class="current">
          {#if current?.banner}<img src={current.banner} alt="" />{:else}<span class="no-banner"><Icon name="tv" size={28} /></span>{/if}
          <strong>{screen.foreground.name}</strong>
        </div>
      {:else}
        <p class="muted">{screen.power === 'on' ? 'Appli en cours inconnue.' : 'Rien : la télé n’est pas allumée.'}</p>
      {/if}

      <h2>Applis de la télé</h2>
      {#if apps.data && apps.data.apps.length}
        <div class="grid">
          {#each apps.data.apps as app (app.package)}
            <button type="button" class="app" disabled={!can.apps || busy} onclick={() => launch(app.package, app.name)}>
              {#if app.banner}<img src={app.banner} alt="" loading="lazy" />{:else}<span class="no-banner"><Icon name="tv" size={28} /></span>{/if}
              <span class="name">{app.name}</span>
            </button>
          {/each}
        </div>
        <p class="muted small">{appsDate(apps.data.at, clock.now)}</p>
      {:else if apps.error}
        <p class="error">{apps.error}</p>
      {:else if apps.data}
        <p class="muted">La télé n’a pas encore envoyé la liste de ses applis.</p>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .remote {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 640px;
    min-height: 100dvh;
    margin: 0 auto;
    padding: calc(12px + env(safe-area-inset-top)) 16px calc(88px + env(safe-area-inset-bottom));
    box-sizing: border-box;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .back {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface);
    color: var(--fg);
  }

  .title {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
  }

  h1 {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 700;
  }

  .status {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 8px;
    padding: 3px 12px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--fg-soft);
    font-size: 0.9rem;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--fg-muted);
  }

  .status.on .dot {
    background: var(--ok);
  }

  .status.standby .dot {
    background: var(--warn);
  }

  .status.offline .dot {
    background: var(--bad);
  }

  .power {
    display: grid;
    width: 56px;
    height: 56px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  .power.on {
    background: var(--danger-fg);
    color: var(--bg);
  }

  .power:disabled {
    opacity: 0.4;
  }

  .pills {
    display: flex;
    gap: 6px;
    padding: 4px;
    border-radius: 999px;
    background: var(--surface);
  }

  .pills button {
    display: inline-flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 44px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-weight: 600;
  }

  .pills button.on {
    background: var(--surface-2);
    color: var(--fg);
  }

  .hint {
    margin: 0;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: var(--warn-bg);
    color: var(--fg);
    font-size: 0.95rem;
  }

  /* Compte rendu du dernier ordre : bandeau flottant en bas, qui ne décale rien. */
  .feedback {
    position: fixed;
    right: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom));
    left: 16px;
    max-width: 608px;
    margin: 0 auto;
    padding: 12px 16px;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    color: var(--fg);
    text-align: center;
    box-shadow: 0 6px 18px rgb(0 0 0 / 40%);
  }

  .feedback.quiet {
    display: none;
  }

  .feedback.error {
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  .pad {
    position: relative;
    width: min(78vw, 300px);
    aspect-ratio: 1;
    margin: 4px auto 8px;
    border-radius: 50%;
    background: var(--surface);
  }

  .arrow {
    position: absolute;
    display: grid;
    width: 34%;
    height: 34%;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--fg);
  }

  .arrow:active:not(:disabled),
  .key:active:not(:disabled) {
    background: var(--surface-2);
  }

  .arrow.up {
    top: 0;
    left: 33%;
    transform: rotate(-90deg);
  }

  .arrow.down {
    bottom: 0;
    left: 33%;
    transform: rotate(90deg);
  }

  .arrow.left {
    top: 33%;
    left: 0;
    transform: rotate(180deg);
  }

  .arrow.right {
    top: 33%;
    right: 0;
  }

  .ok {
    position: absolute;
    top: 30%;
    left: 30%;
    width: 40%;
    height: 40%;
    border: 0;
    border-radius: 50%;
    background: var(--rain);
    color: var(--bg);
    font: inherit;
    font-size: 1.5rem;
    font-weight: 800;
    box-shadow: 0 6px 18px rgb(0 0 0 / 35%);
  }

  .ok:active:not(:disabled) {
    background: var(--rain-soft);
  }

  button:disabled {
    opacity: 0.35;
  }

  .row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 58px;
    border: 0;
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--fg);
  }

  .sign {
    font-size: 1.4rem;
    font-weight: 700;
  }

  h2 {
    margin: 8px 0 0;
    color: var(--fg-muted);
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .typing {
    display: flex;
    gap: 8px;
  }

  .typing input {
    flex: 1;
    min-width: 0;
    min-height: 52px;
    padding: 0 18px;
    border: 2px solid var(--surface-2);
    border-radius: 999px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, 1.05rem);
  }

  .send {
    display: grid;
    width: 52px;
    height: 52px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--rain);
    color: var(--bg);
  }

  .dinner {
    min-height: 56px;
    margin-top: 6px;
    background: var(--sun);
    color: var(--bg);
    font-size: 1.2rem;
    font-weight: 800;
  }

  .current {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .current img,
  .current .no-banner {
    width: 112px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .app {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
  }

  .app img,
  .no-banner {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    object-fit: cover;
  }

  .no-banner {
    display: grid;
    place-items: center;
    background: var(--surface-2);
    color: var(--fg-muted);
  }

  .name {
    overflow: hidden;
    font-size: 0.85rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    margin: 0;
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.85rem;
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }
</style>
