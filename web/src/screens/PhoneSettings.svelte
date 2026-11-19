<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { getAppContext } from '../lib/context.ts';
  import { loadPairing } from '../lib/phone.ts';
  import { watchLines } from '../lib/next-trip.ts';
  import { browserEnvironment, browserPushState, isIos, pushHealth, pushSupport, subscribeBrowser, unsubscribeBrowser, type PushPermission } from '../lib/push.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { phonePath } from '../lib/route.ts';
  import type { PushPrefs } from '../../../shared/types.ts';

  // Réglages du téléphone (/m/reglages, roue dentée de l'en-tête). En tête, le bloc « Notifications » vérifie qu'elles
  // marchent vraiment sur ce téléphone (diagnostic pur pushHealth : prise en charge, permission, abonnement du navigateur
  // comparé à celui que garde le serveur), revérifié à l'ouverture et au retour au premier plan, et propose l'action qui
  // va : Activer, Réparer (réabonnement), ou, quand tout est bon, Envoyer un essai et Couper. C'est l'interrupteur
  // général : une fois actives, un interrupteur par notification (« Pars dans 5 min », « Nouveaux mots », « Minuteurs »,
  // « Tâches en retard », gardés par le serveur pour ce téléphone, tout activé au départ). Sur iPhone, possible seulement
  // une fois HomeHub ajouté à l'écran d'accueil et ouvert depuis son icône : l'écran le dit. Un mot sur la position,
  // utilisée pour le prochain trajet sans être gardée. Le serveur rattache l'abonnement à ce téléphone appairé (et
  // l'oublie s'il est retiré). Sous la carte, une ligne discrète dit quel rendez-vous « Pars dans 5 min » surveille, ou
  // pourquoi aucun (lieu non reconnu, rien dans les 3 h) : de quoi comprendre une notification qui ne vient pas.
  const { api, navigate } = getAppContext();
  const pairing = loadPairing();
  const env = browserEnvironment();
  const ios = isIos(env.userAgent);
  const support = pushSupport(env);
  const status = createResource(() => api.pushStatus(), 5 * 60_000);
  const watch = createResource(async () => (pairing ? api.tripWatch() : null), 60_000);
  /** Ce que dit le navigateur (permission, abonnement) ; `null` tant qu'il n'a pas répondu. */
  let local = $state<{ permission: PushPermission; localEndpoint: string | null } | null>(null);
  async function readLocal() {
    if (support === 'ok') local = await browserPushState().catch(() => ({ permission: null, localEndpoint: null }));
  }
  /** Revérifie tout : navigateur et serveur. */
  const recheck = () => Promise.all([readLocal(), status.refresh()]);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void recheck();
  };
  void readLocal();
  document.addEventListener('visibilitychange', onVisible);
  onDestroy(() => {
    document.removeEventListener('visibilitychange', onVisible);
    status.destroy();
    watch.destroy();
  });
  const health = $derived(
    support !== 'ok'
      ? pushHealth({ support, permission: null, localEndpoint: null, server: null })
      : local
        ? pushHealth({ support, ...local, server: status.data })
        : ({ state: 'checking', action: 'none' } as const),
  );
  let busy = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function run(action: () => Promise<string | null>) {
    busy = true;
    error = null;
    message = null;
    try {
      message = await action();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
      await recheck();
    }
  }

  /** Activer et Réparer : permission (accordée d'office si elle l'est déjà), nouvel abonnement, envoyé au serveur. */
  const enable = (done: string) =>
    run(async () => {
      const current = status.data ?? (await api.pushStatus());
      await api.subscribePush(await subscribeBrowser(current.publicKey));
      return done;
    });
  const disable = () =>
    run(async () => {
      await unsubscribeBrowser().catch(() => {});
      await api.unsubscribePush();
      return 'Notifications coupées.';
    });
  /** Coupe ou remet une notification ; l'interrupteur bouge tout de suite, le serveur confirme. */
  async function toggle(kind: keyof PushPrefs) {
    const current = status.data;
    if (!current) return;
    error = null;
    message = null;
    status.set({ ...current, prefs: { ...current.prefs, [kind]: !current.prefs[kind] } });
    try {
      status.set(await api.savePushPrefs({ [kind]: !current.prefs[kind] }));
    } catch (err) {
      status.set(current);
      error = (err as Error).message;
    }
  }
  const KINDS: { kind: keyof PushPrefs; name: string; hint: string }[] = [
    { kind: 'trips', name: 'Pars dans 5 min', hint: 'Trajet du matin et prochain rendez-vous qui a une adresse (calculé depuis la maison). Une seule par trajet ; touchée, elle ouvre le trajet.' },
    { kind: 'notes', name: 'Nouveaux mots', hint: 'Un mot laissé pour toi ou pour toute la famille, avec son texte ; touchée, elle ouvre les mots.' },
    { kind: 'timers', name: 'Minuteurs', hint: 'Un minuteur que tu as lancé arrive à zéro, même tablette éteinte (sans auteur connu : les parents).' },
    { kind: 'tasks', name: 'Tâches en retard', hint: 'Le lendemain matin d’une échéance, une tâche à toi pas cochée, avec son texte (celles de la famille : les parents) ; touchée, elle ouvre les tâches.' },
  ];
  /** Pourquoi réparer, dit simplement. */
  const REPAIR = {
    browser: 'Le téléphone a perdu son abonnement aux notifications (données du navigateur effacées, mise à jour…).',
    server: 'HomeHub ne connaît plus ce téléphone pour les notifications (abonnement expiré ou refusé par le service de push).',
    mismatch: 'Le téléphone et HomeHub n’ont pas le même abonnement : les notifications partiraient vers un ancien.',
  };
  const test = () =>
    run(async () => {
      await api.testPush();
      return 'Notification d’essai envoyée : elle doit arriver dans quelques secondes.';
    });
</script>

<div class="settings">
  <header>
    <button type="button" class="back" aria-label="Retour à l’appli" onclick={() => navigate(phonePath('shopping'))}><Icon name="back" size={28} strokeWidth={2.2} /></button>
    <h1>Réglages</h1>
  </header>

  {#if !pairing}
    <p class="muted">Ce téléphone n’est pas relié à HomeHub.</p>
  {:else}
    <section class="card">
      <h2><Icon name="bell" size={22} /> Notifications</h2>
      <p class="muted">« Pars dans 5 min » pour tes trajets, les nouveaux mots qu’on te laisse, tes minuteurs et tes tâches en retard. Elles arrivent même quand HomeHub est fermé.</p>

      {#if health.state === 'ios-install'}
        <p class="state">Pas encore possibles ici</p>
        <div class="notice">
          <strong>Sur iPhone, ajoute d’abord HomeHub à l’écran d’accueil.</strong>
          <p>Il faut iOS 16.4 ou plus récent. Dans Safari : bouton Partager, puis « Sur l’écran d’accueil ». Ouvre ensuite HomeHub depuis son icône et reviens ici.</p>
        </div>
      {:else if health.state === 'insecure'}
        <p class="state">Non prises en charge</p>
        <p class="notice">Les notifications demandent une connexion sécurisée (adresse en https).</p>
      {:else if health.state === 'unsupported'}
        <p class="state">Non prises en charge</p>
        <p class="notice">
          {ios
            ? 'Cet iPhone ne sait pas recevoir les notifications de HomeHub : il faut iOS 16.4 ou plus récent, et HomeHub ouvert depuis son icône de l’écran d’accueil.'
            : 'Ce navigateur ne sait pas recevoir de notifications : ouvre HomeHub dans Chrome, Firefox, Edge ou Samsung Internet.'}
        </p>
      {:else if health.state === 'denied'}
        <p class="state bad">Refusées sur ce téléphone</p>
        <div class="notice">
          <strong>HomeHub ne peut pas redemander : réautorise-les à la main, puis reviens ici.</strong>
          <p>
            {ios
              ? 'Réglages de l’iPhone › Notifications › HomeHub › Autoriser les notifications.'
              : 'Dans le navigateur : cadenas à gauche de l’adresse › Autorisations › Notifications ; ou Paramètres du téléphone › Applis › HomeHub (ou le navigateur) › Notifications.'}
          </p>
        </div>
      {:else if health.state === 'checking'}
        {#if status.error}<p class="error">{status.error}</p>{:else}<p class="state">Vérification…</p>{/if}
      {:else if health.state === 'ask' || health.state === 'off'}
        <p class="state">{health.state === 'ask' ? 'Pas encore activées sur ce téléphone' : 'Coupées sur ce téléphone'}</p>
        <div class="actions">
          <button type="button" class="btn primary" disabled={busy} onclick={() => enable('Notifications activées sur ce téléphone.')}>Activer</button>
        </div>
      {:else if health.state === 'repair'}
        <p class="state bad">À réparer</p>
        <p class="notice">{REPAIR[health.reason]}</p>
        <div class="actions">
          <button type="button" class="btn primary" disabled={busy} onclick={() => enable('Notifications réparées : envoie un essai pour vérifier.')}>Réparer</button>
        </div>
      {:else if status.data}
        <p class="state on"><Icon name="check" size={22} strokeWidth={2.6} /> Notifications actives</p>
        <ul class="kinds">
          {#each KINDS as k (k.kind)}
            <li>
              <button type="button" class="switch" role="switch" aria-checked={status.data.prefs[k.kind]} aria-label={k.name} onclick={() => toggle(k.kind)}><span></span></button>
              <span class="what" class:off={!status.data.prefs[k.kind]}>
                <span class="name">{k.name}</span>
                <span class="muted small">{k.hint}</span>
              </span>
            </li>
          {/each}
        </ul>
        <div class="actions">
          <button type="button" class="btn small" disabled={busy} onclick={test}>Envoyer un essai</button>
          <button type="button" class="btn small" disabled={busy} onclick={disable}>Couper</button>
        </div>
        <p class="muted small">
          {ios
            ? 'iPhone : réglage aussi dans Réglages › Notifications › HomeHub.'
            : 'Rien n’arrive quand HomeHub est fermé ? Vérifie l’optimisation de la batterie : Paramètres › Applis › le navigateur (ou HomeHub) › Batterie › Sans restriction.'}
        </p>
      {/if}
      {#if message}<p class="ok">{message}</p>{/if}
      {#if error}<p class="error">{error}</p>{/if}
      {#if watch.data}
        <div class="watch" aria-label="Rendez-vous suivi">
          {#each watchLines(watch.data) as line, i (i)}<p class="muted small">{line}</p>{/each}
        </div>
      {/if}
    </section>

    <section class="card">
      <h2><Icon name="pin" size={22} /> Position</h2>
      <p class="muted">La carte « Prochain trajet » demande la position du téléphone quand un rendez-vous approche. Elle sert au calcul de l’itinéraire puis est oubliée : ni gardée, ni montrée à quelqu’un d’autre.</p>
    </section>
  {/if}
</div>

<style>
  .kinds {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .kinds li {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .switch {
    flex-shrink: 0;
    position: relative;
    width: 60px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
  }

  .switch span {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--fg-muted);
    transition: transform 0.15s;
  }

  .switch[aria-checked='true'] {
    background: var(--rain);
  }

  .switch[aria-checked='true'] span {
    transform: translateX(26px);
    background: var(--bg);
  }

  .what {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    font-weight: 600;
  }

  .what.off .name {
    color: var(--fg-muted);
  }

  .watch {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--surface-2);
  }

  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: 640px;
    height: 100dvh;
    margin: 0 auto;
    padding: calc(12px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
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

  h1 {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 700;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 18px;
    background: var(--surface);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 1.2rem;
  }

  p {
    margin: 0;
  }

  .muted {
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.9rem;
  }

  .notice {
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--warn-bg);
    color: var(--fg);
  }

  .notice p {
    margin-top: 6px;
    color: var(--fg-soft);
  }

  .state {
    font-weight: 700;
    color: var(--fg-muted);
  }

  .state.on {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ok);
  }

  .state.bad {
    color: var(--danger-fg);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .ok {
    color: var(--ok-fg);
  }

  .error {
    color: var(--danger-fg);
  }
</style>
