<script lang="ts">
  import { FAMILY_ID, type Note } from '../../../../shared/types.ts';
  import { formatAgo } from '../../lib/format.ts';
  import type { Profile } from '../../lib/profiles.ts';
  import Avatar from '../Avatar.svelte';

  // Onglet Mots du téléphone : les mots reçus (pour moi ou pour toute la famille), les nouveaux d'abord, avec « Vu ».
  type Props = {
    /** Mots reçus, déjà triés ; null tant qu'ils ne sont pas chargés. */
    received: Note[] | null;
    loadError: string | null;
    actionError: string | null;
    now: Date;
    profileOf: (id: string) => Profile | undefined;
    canSee: (note: Note) => boolean;
    onSee: (note: Note) => void;
  };
  let { received, loadError, actionError, now, profileOf, canSee, onSee }: Props = $props();
</script>

{#if actionError}<p class="error">{actionError}</p>{/if}
{#if received}
  <ul class="notes">
    {#each received as note (note.id)}
      {@const author = profileOf(note.from.ownerId ?? '')}
      <li class:read={note.seenAt}>
        {#if author}<Avatar profile={author} size={36} />{/if}
        <div class="note-body">
          <span class="note-text">{note.text}</span>
          <span class="muted small">
            {author?.name ?? 'Tablette'}{note.to === FAMILY_ID ? ' · pour la famille' : ''} · {formatAgo(new Date(note.at), now)}
          </span>
        </div>
        {#if !note.seenAt && canSee(note)}
          <button type="button" class="seen" onclick={() => onSee(note)}>Vu</button>
        {/if}
      </li>
    {:else}
      <li class="muted">Pas de mot cette semaine.</li>
    {/each}
  </ul>
{:else if loadError}
  <p class="muted">Impossible de charger les mots : {loadError}</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }

  .error {
    margin: 0 0 12px;
    color: var(--danger-fg);
  }

  .notes {
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: 18px;
    background: var(--surface);
  }

  .notes li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--surface-2);
  }

  .notes li:last-child {
    border-bottom: 0;
  }

  .notes li.read {
    opacity: 0.55;
  }

  .note-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .note-text {
    font-size: 1.15rem;
    overflow-wrap: anywhere;
  }

  .small {
    font-size: 0.9rem;
  }

  .seen {
    min-height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--rain);
    color: var(--bg);
    font: inherit;
    font-weight: 700;
  }
</style>
