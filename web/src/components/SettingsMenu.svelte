<script lang="ts">
  import { onDestroy } from 'svelte';
  import { getAppContext } from '../lib/context.ts';
  import { dashboardLayout } from '../lib/layout.svelte.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import { type DetailName, detailPath } from '../lib/route.ts';
  import Icon from './Icon.svelte';

  // Roue dentée de la tablette : pages d'administration, rarement utiles (téléphones reliés, visages, routines, transports, état
  // du NAS).
  // Absente sur tout autre appareil. Le menu s'ouvre au-dessus du bouton (accueil) ou à sa droite (rail) ; il est
  // placé par rapport à l'écran, car le rail fait défiler (et rognerait) ce qu'il contient.
  // `labelled` : bouton de la barre d'actions de l'accueil (icône et mot « Réglages », largeur donnée par la barre).
  type Props = { placement: 'above' | 'side'; size: number; labelled?: boolean };
  let { placement, size, labelled = false }: Props = $props();

  const GAP = 12;

  const { api, router, navigate } = getAppContext();
  const me = createResource(() => api.me(), 5 * 60_000);
  onDestroy(me.destroy);

  let button = $state<HTMLButtonElement>();
  let position = $state<string | null>(null);

  function toggle() {
    if (position || !button) {
      position = null;
      return;
    }
    const rect = button.getBoundingClientRect();
    position =
      placement === 'above'
        ? `right: ${innerWidth - rect.right}px; bottom: ${innerHeight - rect.top + GAP}px`
        : `left: ${rect.right + GAP}px; bottom: ${innerHeight - rect.bottom}px`;
  }

  function go(name: DetailName) {
    position = null;
    navigate(detailPath(name, router.route));
  }
</script>

{#if me.data?.kiosk}
  <button
    bind:this={button}
    class="gear"
    class:open={position}
    class:labelled
    type="button"
    aria-label="Réglages"
    aria-expanded={position !== null}
    style:width={labelled ? undefined : `${size}px`}
    style:height="{size}px"
    onclick={toggle}
  >
    <Icon name="settings" size={labelled ? 32 : Math.round(size * 0.5)} />
    {#if labelled}<span>Réglages</span>{/if}
  </button>

  {#if position}
    <div class="backdrop" role="presentation" onclick={() => (position = null)}></div>
    <div class="menu" role="menu" style={position}>
      <button type="button" role="menuitem" onclick={() => go('phones')}><Icon name="phone" size={28} /> Téléphones</button>
      <button type="button" role="menuitem" onclick={() => go('faces')}><Icon name="face" size={28} /> Visages</button>
      <button type="button" role="menuitem" onclick={() => go('routines')}><Icon name="list" size={28} /> Routines</button>
      <button type="button" role="menuitem" onclick={() => go('transit')}><Icon name="bus" size={28} /> Transports</button>
      <button type="button" role="menuitem" onclick={() => go('nas')}><Icon name="server" size={28} /> État du NAS</button>
      <!-- Essai du dashboard « focus » des élèves : bascule propre à cette tablette. -->
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={dashboardLayout.current === 'focus'}
        onclick={() => {
          dashboardLayout.set(dashboardLayout.current === 'focus' ? 'classic' : 'focus');
          position = null;
        }}
      >
        <Icon name="school" size={28} />
        <span class="choice">
          Dashboard élève : {dashboardLayout.current === 'focus' ? 'focus' : 'classique'}
          <span class="hint">toucher pour passer au {dashboardLayout.current === 'focus' ? 'classique' : 'focus'}</span>
        </span>
      </button>
      <div class="version">HomeHub v{__APP_VERSION__}</div>
    </div>
  {/if}
{/if}

<style>
  button {
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .gear {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    padding: 0;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--fg-muted);
  }

  .gear.labelled {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: var(--text-label);
    font-weight: 600;
  }

  .gear.open,
  .gear:active {
    background: var(--border-strong);
    color: var(--fg);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
  }

  .menu {
    position: fixed;
    z-index: 11;
    display: flex;
    flex-direction: column;
    min-width: 300px;
    padding: 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .menu button {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 64px;
    padding: 0 18px;
    border-radius: 16px;
    font-size: 1.3rem;
    font-weight: 600;
    text-align: left;
  }

  .menu button:active {
    background: var(--border-strong);
  }

  .choice {
    display: flex;
    flex-direction: column;
  }

  .hint {
    font-size: 0.95rem;
    font-weight: 400;
    color: var(--fg-muted);
  }

  .version {
    margin: 6px 8px 0;
    padding: 12px 10px 4px;
    border-top: 1px solid var(--border-strong);
    font-size: 1rem;
    color: var(--fg-muted);
  }
</style>
