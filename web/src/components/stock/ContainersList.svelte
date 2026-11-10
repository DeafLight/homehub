<script lang="ts">
  import type { Container } from '../../../../shared/types.ts';
  import { containerState } from '../../lib/stock.ts';
  import Icon from '../Icon.svelte';

  // Contenants de la maison (page Stock) : bidons et bocaux où l'on transvase les recharges, pleins ou vides. Sur la
  // tablette : déclarer vide, étiquette à imprimer, et en ajouter un ; sur le téléphone, en lecture.
  type Props = {
    containers: Container[];
    phone: boolean;
    readOnly: boolean;
    busy: boolean;
    onEmpty: (container: Container) => void;
    onLabel: (container: Container) => void;
    /** Nouveau contenant ; vrai s'il a été créé (le champ se vide). */
    onAdd: (name: string) => Promise<boolean>;
  };
  let { containers, phone, readOnly, busy, onEmpty, onLabel, onAdd }: Props = $props();

  let newContainer = $state('');

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const name = newContainer.trim();
    if (name && (await onAdd(name))) newContainer = '';
  }
</script>

<ul class="containers">
  {#each containers as container (container.id)}
    <li>
      <Icon name="jar" size={26} color={container.full ? 'var(--ok)' : 'var(--fg-muted)'} />
      <span class="container-text">
        <strong>{container.name}</strong>
        <span>{containerState(container)}</span>
      </span>
      {#if !phone}
        {#if !readOnly && container.full}
          <button type="button" class="btn small" disabled={busy} onclick={() => onEmpty(container)}>Vide</button>
        {/if}
        <button type="button" class="btn small" aria-label="Étiquette de {container.name}" onclick={() => onLabel(container)}>
          <Icon name="barcode" size={20} />
        </button>
      {/if}
    </li>
  {/each}
</ul>
{#if !readOnly && !phone}
  <form class="add" onsubmit={add}>
    <input bind:value={newContainer} maxlength="60" placeholder="Nouveau contenant" aria-label="Nouveau contenant" />
    <button type="submit" class="btn small" disabled={busy || !newContainer.trim()}><Icon name="plus" size={20} /> Ajouter</button>
  </form>
{/if}

<style>
  .containers {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .containers li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 64px;
    border-bottom: 1px solid var(--surface-2);
  }

  .container-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .container-text span {
    color: var(--fg-muted);
  }

  .add {
    display: flex;
    gap: var(--space-1);
  }

  .add input {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0 16px;
    border: 2px solid var(--surface-2);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, var(--text-small));
  }
</style>
