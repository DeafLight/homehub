<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import FaceCheck from './components/FaceCheck.svelte';
  import StatusBanner from './components/StatusBanner.svelte';
  import { getAppContext } from './lib/context.ts';
  import { watchIdle } from './lib/idle.ts';
  import { sharedText } from './lib/lists.ts';
  import { HOME_PATH, isPhoneRoute, routePath } from './lib/route.ts';
  import { watchVersion } from './lib/version.ts';
  import Dashboard from './screens/Dashboard.svelte';
  import Faces from './screens/Faces.svelte';
  import Home from './screens/Home.svelte';
  import Lists from './screens/Lists.svelte';
  import Nas from './screens/Nas.svelte';
  import Pair from './screens/Pair.svelte';
  import Phone from './screens/Phone.svelte';
  import Phones from './screens/Phones.svelte';
  import Weather from './screens/Weather.svelte';
  import Week from './screens/Week.svelte';

  const VERSION_CHECK_MS = 30_000;

  const { api, actor, config, router } = getAppContext();

  let reachable = $state(true);

  // De retour à l'accueil (geste, ou inactivité) : la personne reconnue n'est plus devant la tablette.
  $effect(() => {
    if (router.route.name === 'home') untrack(() => actor.end());
  });

  onMount(() => {
    const stopVersion = watchVersion({
      api,
      currentVersion: __APP_VERSION__,
      currentConfigRevision: config.revision,
      intervalMs: VERSION_CHECK_MS,
      onReachable: (value) => (reachable = value),
    });
    // Sans contact pendant un moment : retour à l'accueil, pour que le suivant tombe sur « Qui est là ? ».
    // Pas sur un téléphone, qui n'a pas d'accueil de tablette.
    const stopIdle = watchIdle(config.ui.idleTimeoutSeconds * 1000, () => {
      if (!isPhoneRoute(router.route)) router.navigate(HOME_PATH);
    });
    return () => {
      stopVersion();
      stopIdle();
    };
  });
</script>

{#if router.route.name === 'dashboard'}
  {#key router.route.ownerId}
    <Dashboard ownerId={router.route.ownerId} />
  {/key}
{:else if router.route.name === 'weather'}
  <Weather back={router.route.back} />
{:else if router.route.name === 'nas'}
  <Nas back={router.route.back} />
{:else if router.route.name === 'lists'}
  <Lists back={router.route.back} />
{:else if router.route.name === 'phones'}
  <Phones back={router.route.back} />
{:else if router.route.name === 'faces'}
  <Faces back={router.route.back} />
{:else if router.route.name === 'phone'}
  <Phone tab={router.route.tab} />
{:else if router.route.name === 'share'}
  <!-- Texte reçu par « Partager » (share_target du manifeste) : l'ajout s'ouvre prérempli. -->
  <Phone tab="tasks" shared={sharedText(new URLSearchParams(location.search))} />
{:else if router.route.name === 'pair'}
  <Pair />
{:else if router.route.name === 'week'}
  <!-- La page d’origine fixe les profils affichés au départ : un autre retour, une nouvelle page. -->
  {#key routePath(router.route)}
    <Week back={router.route.back} />
  {/key}
{:else}
  <Home />
{/if}

{#if actor.asking}
  <FaceCheck />
{/if}

{#if actor.notice}
  <div class="notice" role="status">{actor.notice}</div>
{/if}

{#if !reachable}
  <StatusBanner message="Serveur injoignable, nouvel essai en cours…" />
{/if}

<style>
  .notice {
    position: fixed;
    left: 50%;
    bottom: 32px;
    z-index: 40;
    transform: translateX(-50%);
    padding: 16px 28px;
    border-radius: 999px;
    background: var(--fg);
    color: var(--bg);
    font-size: 1.2rem;
    font-weight: 600;
    pointer-events: none;
  }
</style>
