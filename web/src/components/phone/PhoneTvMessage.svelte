<script lang="ts">
  import { TV_MESSAGE_MAX, tvMessageLength, tvMessageValid, type TvMessageSent } from '../../../../shared/tv.ts';
  import type { Api } from '../../lib/api.ts';
  import Icon from '../Icon.svelte';

  // Message à la télé (onglet Caméra, parents, si une télé est configurée) : on écrit un court texte, la télé Android
  // TV l'affiche en gros au milieu de l'écran, par-dessus ce qu'elle diffuse, pendant quelques secondes. Le compteur
  // suit la règle du serveur (shared/tv.ts), qui nettoie et limite de nouveau le texte.
  type Props = { api: Api };
  let { api }: Props = $props();

  let open = $state(false);
  let text = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let sent = $state<TvMessageSent | null>(null);
  let field = $state<HTMLTextAreaElement>();

  const length = $derived(tvMessageLength(text));
  const valid = $derived(tvMessageValid(text));

  function show() {
    open = true;
    sent = null;
    error = null;
    queueMicrotask(() => field?.focus());
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    busy = true;
    error = null;
    try {
      sent = await api.sendTvMessage(text);
      text = '';
      open = false;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section class="tv" aria-label="Message à la télé">
  {#if open}
    <form onsubmit={submit}>
      <label for="tv-text">Message à la télé</label>
      <textarea id="tv-text" bind:this={field} bind:value={text} rows="3" maxlength={TV_MESSAGE_MAX * 4} placeholder="À table dans 5 minutes !" enterkeyhint="send"></textarea>
      <div class="row">
        <span class="count" class:over={length > TV_MESSAGE_MAX} aria-live="polite">{length} / {TV_MESSAGE_MAX}</span>
        <button type="button" class="btn" onclick={() => (open = false)}>Annuler</button>
        <button type="submit" class="btn primary" disabled={!valid || busy}><Icon name="tv" size={22} /> {busy ? 'Envoi…' : 'Envoyer'}</button>
      </div>
      <p class="muted">Il s’affiche en gros au milieu de la télé, par-dessus l’image, avec ton prénom.</p>
    </form>
  {:else}
    <button type="button" class="btn wide" onclick={show}><Icon name="tv" size={24} /> Message à la télé</button>
  {/if}
  {#if sent}
    <p class="sent" role="status">Affiché sur la télé pendant {sent.seconds} s : « {sent.text} »</p>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .tv {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  label {
    font-weight: 600;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1.1rem;
    resize: vertical;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .count {
    margin-right: auto;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .count.over {
    color: var(--danger-fg);
    font-weight: 600;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
  }

  .btn:disabled {
    opacity: 0.5;
  }

  .btn.wide {
    justify-content: center;
    padding: 14px 18px;
    font-weight: 600;
  }

  .btn.primary {
    border-color: var(--rain);
    background: var(--rain);
    color: var(--bg);
    font-weight: 600;
  }

  p {
    margin: 0;
  }

  .muted,
  .sent {
    color: var(--fg-muted);
    font-size: 0.95rem;
  }

  .error {
    color: var(--danger-fg);
  }
</style>
