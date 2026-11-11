<script lang="ts">
  import { onMount } from 'svelte';
  import Presence from './components/Presence.svelte';
  import Screensaver from './components/Screensaver.svelte';
  import StatusBanner from './components/StatusBanner.svelte';
  import Timers from './components/Timers.svelte';
  import { getAppContext } from './lib/context.ts';
  import { watchIdle } from './lib/idle.ts';
  import { sharedText } from './lib/lists.ts';
  import { sharedRecipe } from './lib/recipes.ts';
  import { HOME_PATH, returnsHomeWhenIdle, routePath } from './lib/route.ts';
  import { watchVersion } from './lib/version.ts';
  import Dashboard from './screens/Dashboard.svelte';
  import Faces from './screens/Faces.svelte';
  import Holidays from './screens/Holidays.svelte';
  import Routines from './screens/Routines.svelte';
  import Scan from './screens/Scan.svelte';
  import Sport from './screens/Sport.svelte';
  import Workout from './screens/Workout.svelte';
  import Stock from './screens/Stock.svelte';
  import Transit from './screens/Transit.svelte';
  import Home from './screens/Home.svelte';
  import Lists from './screens/Lists.svelte';
  import Nas from './screens/Nas.svelte';
  import Pair from './screens/Pair.svelte';
  import Phone from './screens/Phone.svelte';
  import Phones from './screens/Phones.svelte';
  import Recipe from './screens/Recipe.svelte';
  import Recipes from './screens/Recipes.svelte';
  import Weather from './screens/Weather.svelte';
  import Week from './screens/Week.svelte';

  const VERSION_CHECK_MS = 30_000;

  const { api, actor, config, router } = getAppContext();

  let reachable = $state(true);

  onMount(() => {
    const stopVersion = watchVersion({
      api,
      currentVersion: __APP_VERSION__,
      currentConfigRevision: config.revision,
      intervalMs: VERSION_CHECK_MS,
      onReachable: (value) => (reachable = value),
    });
    return stopVersion;
  });

  // Sans contact pendant un moment : retour à l'accueil, pour que le suivant tombe sur « Qui est là ? ».
  // Pas sur un téléphone, qui n'a pas d'accueil de tablette, ni pendant un scan (personne ne touche l'écran : le
  // scanner se ferme seul après quelques minutes sans lecture) ou une séance guidée. Le délai repart de zéro en
  // quittant ces pages.
  const idleHome = $derived(returnsHomeWhenIdle(router.route));
  $effect(() => {
    if (!idleHome) return;
    return watchIdle(config.ui.idleTimeoutSeconds * 1000, () => router.navigate(HOME_PATH));
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
{:else if router.route.name === 'routines'}
  <Routines back={router.route.back} />
{:else if router.route.name === 'transit'}
  <Transit back={router.route.back} />
{:else if router.route.name === 'holidays'}
  <Holidays back={router.route.back} />
{:else if router.route.name === 'scan'}
  <Scan back={router.route.back} />
{:else if router.route.name === 'stock'}
  <Stock back={router.route.back} />
{:else if router.route.name === 'sport'}
  <Sport back={router.route.back} />
{:else if router.route.name === 'workout'}
  <Workout back={router.route.back} />
{:else if router.route.name === 'recipes'}
  <Recipes back={router.route.back} />
{:else if router.route.name === 'recipe'}
  {#key router.route.id}
    <Recipe id={router.route.id} mode={router.route.mode} />
  {/key}
{:else if router.route.name === 'phonerecipe'}
  {#key router.route.id}
    <Recipe id={router.route.id} mode={router.route.mode} phone />
  {/key}
{:else if router.route.name === 'phonescan'}
  <Scan back={null} />
{:else if router.route.name === 'phonestock'}
  <Stock back={null} />
{:else if router.route.name === 'phone'}
  <Phone tab={router.route.tab} />
{:else if router.route.name === 'share'}
  <!-- Reçu par « Partager » (share_target du manifeste, POST renvoyé ici en GET par le serveur) : un lien ouvre
       l'import de recette (ou, au choix, l'ajout à une liste) ; un texte copié d'une recette ou une page enregistrée,
       l'aperçu de l'import ; un autre texte, l'ajout prérempli. -->
  {@const params = new URLSearchParams(location.search)}
  {@const found = sharedRecipe(params)}
  <Phone tab={found ? 'recipes' : 'tasks'} shared={sharedText(params)} sharedRecipe={found ?? undefined} />
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

<Presence />
<Screensaver />
<Timers />

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
