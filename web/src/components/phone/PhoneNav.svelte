<script lang="ts">
  import type { PhoneTabItem } from '../../lib/phone-app.ts';
  import type { PhoneTab } from '../../lib/route.ts';
  import Icon from '../Icon.svelte';

  // Barre d'onglets du bas du téléphone, avec les pastilles : mots à voir, étapes de la routine à cocher.
  type Props = {
    tabs: PhoneTabItem[];
    current: PhoneTab;
    unseen: number;
    routineLeft: number;
    onGo: (tab: PhoneTab) => void;
  };
  let { tabs, current, unseen, routineLeft, onGo }: Props = $props();
</script>

<nav style:grid-template-columns={`repeat(${tabs.length}, 1fr)`}>
  {#each tabs as item (item.tab)}
    <button type="button" class:on={item.tab === current} aria-current={item.tab === current ? 'page' : undefined} onclick={() => onGo(item.tab)}>
      <span class="tab-icon">
        <Icon name={item.icon} size={26} />
        {#if item.tab === 'notes' && unseen > 0}<span class="badge">{unseen}</span>{/if}
        {#if item.tab === 'tasks' && routineLeft > 0}<span class="badge routine-badge">{routineLeft}</span>{/if}
      </span>
      {item.label}
    </button>
  {/each}
</nav>

<style>
  .badge.routine-badge {
    background: var(--rain-soft);
  }

  .tab-icon {
    position: relative;
    display: inline-grid;
  }

  .badge {
    position: absolute;
    top: -6px;
    right: -12px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--danger-fg);
    color: var(--bg);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
  }

  nav {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    padding: 6px 8px calc(8px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--surface-2);
    background: var(--surface-rail);
  }

  nav button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 0;
    border-radius: 14px;
    border: 0;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
  }

  nav button.on {
    color: var(--fg);
    background: var(--surface-2);
  }
</style>
