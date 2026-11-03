<script lang="ts">
  import type { Note } from '../../../../shared/types.ts';
  import { formatAgo } from '../../lib/format.ts';
  import type { Profile } from '../../lib/profiles.ts';
  import Avatar from '../Avatar.svelte';
  import Card from '../Card.svelte';
  import Icon from '../Icon.svelte';

  // Mots laissés au profil (ou à la famille) et pas encore vus : le plus récent, puis les suivants une fois « Vu ».
  // `compact` : dans la colonne d'un profil qui a un emploi du temps.
  type Props = {
    notes: Note[];
    profiles: Profile[];
    now: Date;
    compact?: boolean;
    onSeen(note: Note): void;
    onWrite(): void;
  };
  let { notes, profiles, now, compact = false, onSeen, onWrite }: Props = $props();

  const note = $derived(notes[0] ?? null);
  const author = $derived(profiles.find((p) => p.id === note?.from.ownerId));
</script>

<Card>
  <div class="note" class:compact>
    <div class="head">
      <span class="label">Mots</span>
      <button type="button" class="write" aria-label="Laisser un mot" onclick={onWrite}>
        <Icon name="plus" size={22} strokeWidth={2.4} /> Mot
      </button>
    </div>

    {#if note}
      <div class="body">
        <span class="text">« {note.text} »</span>
        <span class="author">
          {#if author}<Avatar profile={author} size={28} />{/if}
          <span>{author ? `${author.name}, ` : ''}{formatAgo(new Date(note.at), now)}</span>
        </span>
      </div>
      <div class="foot">
        {#if notes.length > 1}<span class="more">+ {notes.length - 1} autre{notes.length > 2 ? 's' : ''}</span>{/if}
        <button type="button" class="seen" onclick={() => onSeen(note)}><Icon name="check" size={22} strokeWidth={2.4} /> Vu</button>
      </div>
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
    gap: 12px;
  }

  .head,
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .foot {
    justify-content: flex-end;
  }

  .label {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--fg-muted);
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 16px 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .seen {
    background: var(--rain);
    color: var(--bg);
  }

  .body {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-align: center;
  }

  .text {
    font-size: 1.6rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .compact .text {
    font-size: 1.3rem;
  }

  .author {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 1.1rem;
    color: var(--fg-muted);
  }

  .more {
    margin-right: auto;
    color: var(--fg-muted);
  }

  .empty {
    flex-grow: 1;
    display: grid;
    place-items: center;
    font-size: 1.15rem;
    color: var(--fg-muted);
  }
</style>
