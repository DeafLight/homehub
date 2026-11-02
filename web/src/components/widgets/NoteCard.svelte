<script lang="ts">
  import type { Note } from '../../../../shared/types.ts';
  import Card from '../Card.svelte';

  type Props = { note: Note | null; authorName: string | null };
  let { note, authorName }: Props = $props();
</script>

<Card>
  <div class="note">
    <span class="label">Mot de la famille</span>
    {#if note}
      <span class="text">« {note.text} »</span>
      {#if authorName}
        <span class="author">— {authorName}</span>
      {/if}
    {:else}
      <span class="empty">Pas de mot pour l’instant</span>
    {/if}
  </div>
</Card>

<style>
  .note {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
  }

  .label,
  .author,
  .empty {
    font-size: 1.15rem;
    color: var(--fg-muted);
  }

  .text {
    font-size: 1.6rem;
    font-weight: 600;
  }
</style>
