<script lang="ts">
  import type { ListTask } from '../../../shared/types.ts';
  import { isLate, taskMeta } from '../lib/lists.ts';
  import type { Profile } from '../lib/profiles.ts';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { revert } from '../lib/checkbox.ts';

  // Tâches de la famille, triées par le serveur (échéance, puis sans date, puis faites aujourd'hui), avec un filtre
  // par personne. Tailles réglables par le parent (--list-font, --list-row) : tablette ou téléphone.
  type Props = {
    tasks: ListTask[];
    profiles: Profile[];
    now: Date;
    /** Personne affichée (null : tout le monde). */
    filter: string | null;
    readOnly?: boolean;
    onFilter(ownerId: string | null): void;
    onToggle(task: ListTask, done: boolean): void;
    onRemove(task: ListTask): void;
  };
  let { tasks, profiles, now, filter, readOnly = false, onFilter, onToggle, onRemove }: Props = $props();

  const profileOf = (id: string | null) => profiles.find((p) => p.id === id);
  const nameOf = (id: string | null) => profileOf(id)?.name ?? null;
  const shown = $derived(filter ? tasks.filter((t) => t.ownerId === filter) : tasks);
  const openCount = (ownerId: string | null) => tasks.filter((t) => !t.done && (!ownerId || t.ownerId === ownerId)).length;
</script>

<div class="tasks">
  <div class="filter" role="radiogroup" aria-label="Pour qui">
    <button type="button" role="radio" aria-checked={filter === null} class="chip" class:on={filter === null} onclick={() => onFilter(null)}>
      Tous · {openCount(null)}
    </button>
    {#each profiles as profile (profile.id)}
      {#if tasks.some((t) => t.ownerId === profile.id) || filter === profile.id}
        <button
          type="button"
          role="radio"
          aria-checked={filter === profile.id}
          class="chip person"
          class:on={filter === profile.id}
          onclick={() => onFilter(profile.id)}
        >
          <Avatar {profile} size={28} />
          {profile.name} · {openCount(profile.id)}
        </button>
      {/if}
    {/each}
  </div>

  <ul>
    {#each shown as task (task.id)}
      {@const owner = profileOf(task.ownerId)}
      <li class:done={task.done}>
        <label>
          <input
            type="checkbox"
            checked={task.done}
            disabled={readOnly}
            style:accent-color={owner?.color ?? 'var(--ok)'}
            onchange={(e) => onToggle(task, revert(e.currentTarget, task.done))}
          />
          <span class="text">
            <span class="label">{task.label}</span>
            <span class="meta" class:late={isLate(task, now)}>{taskMeta(task, now, nameOf)}</span>
          </span>
          {#if owner && !filter}<Avatar profile={owner} size={36} dimmed={task.done} />{/if}
        </label>
        {#if !readOnly}
          <button type="button" class="remove" aria-label="Supprimer {task.label}" onclick={() => onRemove(task)}>
            <Icon name="close" size={22} />
          </button>
        {/if}
      </li>
    {:else}
      <li class="empty">Rien à faire !</li>
    {/each}
  </ul>
</div>

<style>
  .tasks {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
  }

  .filter {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg-soft);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
  }

  .chip.person {
    padding-left: 8px;
  }

  .chip.on {
    background: var(--fg);
    color: var(--bg);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--surface-2);
  }

  li:last-child {
    border-bottom: 0;
  }

  label {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 14px;
    min-width: 0;
    min-height: var(--list-row, 58px);
    padding: 6px 0;
  }

  input {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    margin: 0;
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .label {
    font-size: var(--list-font, 1.3rem);
    overflow-wrap: anywhere;
  }

  .meta {
    font-size: 0.95rem;
    color: var(--fg-muted);
  }

  .meta.late {
    color: var(--bad);
    font-weight: 600;
  }

  li.done .label {
    color: var(--fg-muted);
    text-decoration: line-through;
  }

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

  .remove:active {
    background: var(--surface-2);
  }

  .empty {
    min-height: var(--list-row, 58px);
    font-size: var(--list-font, 1.3rem);
    color: var(--fg-muted);
    border: 0;
  }
</style>
