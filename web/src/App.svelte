<script lang="ts">
  import { onMount } from 'svelte';
  import StatusBanner from './components/StatusBanner.svelte';
  import { getAppContext } from './lib/context.ts';
  import { watchIdle } from './lib/idle.ts';
  import { HOME_PATH } from './lib/route.ts';
  import { watchVersion } from './lib/version.ts';
  import Dashboard from './screens/Dashboard.svelte';
  import Home from './screens/Home.svelte';
  import Weather from './screens/Weather.svelte';

  const VERSION_CHECK_MS = 30_000;

  const { api, config, router } = getAppContext();

  let reachable = $state(true);

  onMount(() => {
    const stopVersion = watchVersion({
      api,
      currentVersion: __APP_VERSION__,
      currentConfigRevision: config.revision,
      intervalMs: VERSION_CHECK_MS,
      onReachable: (value) => (reachable = value),
    });
    // Sans contact pendant un moment : retour à l'accueil, pour que le suivant tombe sur « Qui est là ? ».
    const stopIdle = watchIdle(config.ui.idleTimeoutSeconds * 1000, () => router.navigate(HOME_PATH));
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
{:else}
  <Home />
{/if}

{#if !reachable}
  <StatusBanner message="Serveur injoignable, nouvel essai en cours…" />
{/if}
