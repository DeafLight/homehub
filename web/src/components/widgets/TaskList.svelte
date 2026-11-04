<script lang="ts">
  import type { Task } from '../../../../shared/types.ts';
  import Card from '../Card.svelte';
  import { revert } from '../../lib/checkbox.ts';

  type Props = {
    title: string;
    tasks: Task[];
    color: string;
    onToggle(task: Task, done: boolean): void;
    /** Le titre ouvre les listes (faux pour une routine, qui ne s'y trouve pas). */
    linked?: boolean;
    /** Ligne sous la liste (encouragement d'une routine). */
    footer?: string | null;
  };
  let { title, tasks, color, onToggle, linked = true, footer = null }: Props = $props();
</script>

<!-- Le titre ouvre les listes, pour ajouter ou voir les tâches de chacun. -->
<Card {title} link={linked ? { to: 'lists', label: `${title} : ouvrir les listes` } : undefined}>
  {#if tasks.length === 0}
    <p class="empty">Rien à faire !</p>
  {:else}
    <ul>
      {#each tasks as task (task.id)}
        <li>
          <label class:done={task.done}>
            <input
              type="checkbox"
              checked={task.done}
              style:accent-color={color}
              onchange={(e) => onToggle(task, revert(e.currentTarget, task.done))}
            />
            {task.label}
          </label>
        </li>
      {/each}
    </ul>
  {/if}
  {#if footer}<p class="footer">{footer}</p>{/if}
</Card>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }

  label {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 52px;
    font-size: 1.3rem;
    cursor: pointer;
  }

  .footer {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--sun);
  }

  label.done {
    color: var(--fg-muted);
    text-decoration: line-through;
  }

  input {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    margin: 0;
  }

  .empty {
    margin: 0;
    font-size: 1.3rem;
    color: var(--fg-muted);
  }
</style>
