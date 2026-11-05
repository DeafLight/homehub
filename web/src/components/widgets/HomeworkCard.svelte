<script lang="ts">
  import type { Homework } from '../../../../shared/types.ts';
  import Card from '../Card.svelte';
  import { homeworkGroups } from '../../lib/homework.ts';

  // Devoirs du cahier de texte, par jour. Lecture seule : un devoir se coche dans Pronote ou ÉcoleDirecte, la
  // coche apparaît ici au rafraîchissement suivant. Toucher un devoir déplie toute la consigne.
  type Props = { homework: Homework[]; now: Date; color: string; compact?: boolean };
  let { homework, now, color, compact = false }: Props = $props();

  const groups = $derived(homeworkGroups(homework, now));
  let open = $state<string | null>(null);
</script>

<Card title="Devoirs">
  {#if groups.length === 0}
    <p class="empty">Aucun devoir à venir</p>
  {:else}
    <div class="list" class:compact>
      {#each groups as group (group.due)}
        <section>
          <h3>
            {group.title}
            <span class="count">{group.left === 0 ? 'tout est fait' : `${group.left} à faire`}</span>
          </h3>
          <ul>
            {#each group.items as item (item.id)}
              {@const expanded = open === item.id}
              <li class:done={item.done}>
                <button type="button" aria-expanded={expanded} onclick={() => (open = expanded ? null : item.id)}>
                  <span class="dot" style:background={item.color ?? color} aria-hidden="true"></span>
                  <span class="body">
                    <span class="subject">
                      {item.subject}
                      {#if item.test}<span class="tag test">Contrôle</span>{/if}
                      {#if item.done}<span class="tag done-tag">✓ fait</span>{/if}
                    </span>
                    {#if item.text}<span class="text" class:expanded>{item.text}</span>{/if}
                    {#if expanded && (item.attachments || item.minutes)}
                      <span class="meta">
                        {#if item.minutes}≈ {item.minutes} min{/if}
                        {#if item.minutes && item.attachments} · {/if}
                        {#if item.attachments}{item.attachments} pièce{item.attachments > 1 ? 's' : ''} jointe{item.attachments > 1 ? 's' : ''}, dans l’appli de l’école{/if}
                      </span>
                    {/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</Card>

<style>
  .empty {
    margin: 0;
    font-size: 1.2rem;
    color: var(--fg-muted);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    overflow-y: auto;
  }

  h3 {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin: 0 0 4px;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--fg-muted);
  }

  .count {
    font-size: 0.95rem;
    font-weight: 400;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    min-height: 52px;
    padding: 8px 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .dot {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    margin-top: 9px;
    border-radius: 50%;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .subject {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .tag {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .tag.test {
    background: var(--warn-bg);
    color: var(--warn);
  }

  .tag.done-tag {
    background: var(--surface-2);
    color: var(--fg-muted);
  }

  .text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 1.1rem;
    color: var(--fg-muted);
    white-space: pre-line;
  }

  .compact .text {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }

  .text.expanded {
    display: block;
  }

  .meta {
    font-size: 0.95rem;
    color: var(--fg-muted);
  }

  li.done .subject,
  li.done .text {
    opacity: 0.55;
  }
</style>
