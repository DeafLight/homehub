<script lang="ts">
  import { untrack } from 'svelte';
  import type { Profile } from '../lib/profiles.ts';
  import Avatar from './Avatar.svelte';

  // Laisser un mot, depuis un profil (celui ouvert sur la tablette, ou celui du téléphone) à un autre : on choisit
  // seulement à qui.
  const MAX = 200;

  type Props = {
    /** Profil qui envoie le mot. */
    from: Profile;
    /** Destinataires possibles : les autres profils (membres et famille). */
    profiles: Profile[];
    onSubmit(input: { to: string; text: string }): Promise<void>;
    onCancel(): void;
  };
  let { from, profiles, onSubmit, onCancel }: Props = $props();

  // Le formulaire est recréé à chaque ouverture ; un seul destinataire possible : choisi d'office.
  let to = $state<string | null>(untrack(() => (profiles.length === 1 ? profiles[0].id : null)));
  let text = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const ready = $derived(text.trim().length > 0 && to !== null && !busy);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!ready || to === null) return;
    busy = true;
    error = null;
    try {
      await onSubmit({ to, text: text.trim() });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<form class="note-form" onsubmit={submit}>
  <div class="title">
    <h2>Laisser un mot</h2>
    <span class="from"><Avatar profile={from} size={32} /> de {from.name}</span>
  </div>

  <fieldset>
    <legend>Pour qui</legend>
    <div class="people">
      {#each profiles as profile (profile.id)}
        <button
          type="button"
          class="person"
          class:on={to === profile.id}
          aria-pressed={to === profile.id}
          aria-label={profile.name}
          onclick={() => (to = profile.id)}
        >
          <Avatar {profile} size={48} />
        </button>
      {/each}
    </div>
  </fieldset>

  <!-- svelte-ignore a11y_autofocus -->
  <textarea bind:value={text} rows="3" maxlength={MAX} placeholder="Ex. Pense à ton goûter !" autofocus></textarea>
  <span class="count">{text.length} / {MAX}</span>

  {#if error}<p class="error">{error}</p>{/if}

  <div class="actions">
    <button type="button" class="secondary" onclick={onCancel}>Annuler</button>
    <button type="submit" class="primary" disabled={!ready}>Envoyer le mot</button>
  </div>
</form>

<style>
  .note-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .from {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--fg-muted);
    font-size: 1.05rem;
  }

  h2 {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 700;
  }

  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 14px 16px;
    border: 2px solid var(--rain);
    border-radius: 16px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 1.2rem;
    resize: none;
    user-select: text;
  }

  .count {
    margin-top: -10px;
    align-self: flex-end;
    font-size: 0.9rem;
    color: var(--fg-muted);
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: 10px;
    padding: 0;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .people {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .person {
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    opacity: 0.45;
  }

  .person.on {
    opacity: 1;
    outline: 3px solid var(--fg);
    outline-offset: 3px;
  }

  .error {
    margin: 0;
    color: var(--danger-fg);
  }

  .actions {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
  }

  .actions button {
    min-height: 56px;
    padding: 0 22px;
    border: 0;
    border-radius: 18px;
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
  }

  .primary {
    background: var(--rain);
    color: var(--bg);
  }

  .primary:disabled {
    opacity: 0.5;
  }

  .secondary {
    background: var(--surface-2);
    color: var(--fg);
  }
</style>
