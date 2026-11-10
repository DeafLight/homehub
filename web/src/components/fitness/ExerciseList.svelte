<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import type { Exercise } from '../../../../shared/fitness-catalogue.ts';
  import ExerciseAnimation from './ExerciseAnimation.svelte';

  // Liste d'exercices de l'onglet Sport (séance du jour, catalogue) : vignette animée figée, nom, et une ligne de
  // détail donnée par l'appelant. Un toucher ouvre la fiche de l'exercice. `boxed` : sur fond de carte (catalogue).
  type Props = {
    items: T[];
    key: (item: T) => string;
    exercise: (item: T) => Exercise;
    detail: Snippet<[T]>;
    boxed?: boolean;
    onOpen: (id: string) => void;
  };
  let { items, key, exercise, detail, boxed = false, onOpen }: Props = $props();
</script>

<ul class="list" class:boxed>
  {#each items as item (key(item))}
    {@const e = exercise(item)}
    <li>
      <button type="button" class="thumbed" onclick={() => onOpen(e.id)}>
        <span class="thumb"><ExerciseAnimation id={e.id} still height={40} /></span>
        <span class="text">
          <span>{e.name}</span>
          <span class="muted small">{@render detail(item)}</span>
        </span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .muted {
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.88rem;
  }

  .list {
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
  }

  .list li {
    border-bottom: 1px solid var(--surface-2);
  }

  .list li:last-child {
    border-bottom: 0;
  }

  .list button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-height: 54px;
    padding: 8px 0;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 1.08rem;
    text-align: left;
  }

  .list button.thumbed {
    flex-direction: row;
    align-items: center;
    gap: 12px;
  }

  .thumb {
    display: grid;
    flex: none;
    width: 64px;
    place-items: center;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  ul.list.boxed {
    padding: 0 14px;
    border-radius: 18px;
    background: var(--surface);
  }
</style>
