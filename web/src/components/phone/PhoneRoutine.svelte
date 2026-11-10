<script lang="ts">
  import type { Routine, Task } from '../../../../shared/types.ts';
  import { routineFooter, routineTitle } from '../../lib/routine.ts';

  // Routine du moment en tête de l'onglet Tâches du téléphone : ses étapes à cocher, et la série en pied.
  type Props = {
    routine: Routine;
    /** Couleur du profil, pour les cases. */
    color: string;
    error: string | null;
    onToggle: (item: Task, done: boolean) => void;
  };
  let { routine, color, error, onToggle }: Props = $props();

  const footer = $derived(routineFooter(routine));
</script>

<section class="routine" aria-label={routineTitle(routine)}>
  <h2>{routineTitle(routine)}</h2>
  {#if error}<p class="error">{error}</p>{/if}
  <ul>
    {#each routine.items as item (item.id)}
      <li>
        <label class:done={item.done}>
          <input type="checkbox" checked={item.done} style:accent-color={color} onchange={(e) => onToggle(item, e.currentTarget.checked)} />
          {item.label}
        </label>
      </li>
    {/each}
  </ul>
  {#if footer}<p class="routine-footer">{footer}</p>{/if}
</section>

<style>
  .error {
    margin: 0 0 12px;
    color: var(--danger-fg);
  }

  .routine {
    margin-bottom: 18px;
    padding: 12px 14px 6px;
    border-radius: 18px;
    background: var(--surface);
  }

  .routine h2 {
    margin: 0 0 4px;
    font-size: 1.15rem;
    font-weight: 700;
  }

  .routine ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .routine li {
    border-bottom: 1px solid var(--surface-2);
  }

  .routine li:last-child {
    border-bottom: 0;
  }

  .routine label {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: var(--list-row);
    font-size: var(--list-font);
  }

  .routine label.done {
    color: var(--fg-muted);
    text-decoration: line-through;
  }

  .routine input {
    width: 26px;
    height: 26px;
    margin: 0;
  }

  .routine-footer {
    margin: 4px 0 8px;
    color: var(--ok-fg);
    font-weight: 600;
  }
</style>
