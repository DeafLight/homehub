<script lang="ts">
  import type { MenuViewEntry } from '../../../../shared/menu.ts';
  import { MENU_LIMITS } from '../../../../shared/menu.ts';
  import { type DayGroup, peopleLabel } from '../../lib/menu.ts';
  import Icon from '../Icon.svelte';

  // Recettes du menu, jour par jour puis « dans la semaine » : le nombre de personnes se règle d'un geste, la croix
  // retire le repas (annulable quelques secondes, voir Menu.svelte) ; toucher le titre ouvre ses réglages (jour,
  // recette). `editable` faux : semaine passée ou lecture seule, ni réglage ni croix.
  type Props = {
    groups: DayGroup[];
    editable: boolean;
    busy: boolean;
    onPeople: (entry: MenuViewEntry, people: number) => void;
    onOpen: (entry: MenuViewEntry) => void;
    onRemove: (entry: MenuViewEntry) => void;
  };
  let { groups, editable, busy, onPeople, onOpen, onRemove }: Props = $props();
</script>

<div class="days">
  {#each groups as group (group.day ?? 'week')}
    <div class="day" class:empty={group.entries.length === 0}>
      <h3>{group.label}</h3>
      {#each group.entries as entry (entry.id)}
        <div class="entry" class:missing={entry.missing}>
          <button type="button" class="title" onclick={() => onOpen(entry)}>
            {entry.title}
            {#if entry.missing}<span class="note">plus au carnet</span>{/if}
          </button>
          {#if editable && !entry.missing}
            <div class="stepper">
              <button type="button" aria-label="Une personne de moins" disabled={busy || entry.people <= 1} onclick={() => onPeople(entry, entry.people - 1)}><Icon name="minus" size={20} /></button>
              <span>{peopleLabel(entry)}</span>
              <button type="button" aria-label="Une personne de plus" disabled={busy || entry.people >= MENU_LIMITS.people} onclick={() => onPeople(entry, entry.people + 1)}><Icon name="plus" size={20} /></button>
            </div>
          {:else}
            <span class="people">{peopleLabel(entry)}</span>
          {/if}
          {#if editable}
            <button type="button" class="remove" aria-label="Retirer du menu" title="Retirer du menu" disabled={busy} onclick={() => onRemove(entry)}><Icon name="close" size={20} /></button>
          {/if}
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .days {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .day {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .day.empty h3 {
    color: var(--fg-muted);
    opacity: 0.7;
  }

  h3 {
    margin: 0;
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--fg-muted);
  }

  .entry {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    min-height: 52px;
    padding: 4px 6px 4px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .entry.missing {
    opacity: 0.6;
  }

  .title {
    flex: 1 1 200px;
    min-width: 0;
    padding: 6px 0;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-body);
    font-weight: 600;
    text-align: left;
    overflow-wrap: anywhere;
  }

  .note {
    display: block;
    font-size: var(--text-small);
    font-weight: 400;
    color: var(--fg-muted);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .stepper span,
  .people {
    min-width: 72px;
    text-align: center;
    font-size: var(--text-small);
    color: var(--fg-soft);
    white-space: nowrap;
  }

  .stepper button {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface);
    color: var(--fg);
  }

  .stepper button:disabled,
  .remove:disabled {
    opacity: 0.4;
  }

  /* Croix de retrait : discrète, au bout de la ligne, aussi grande au doigt que les boutons du nombre. */
  .remove {
    display: grid;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--fg-muted);
  }

  .entry.missing .remove {
    margin-left: auto;
  }
</style>
