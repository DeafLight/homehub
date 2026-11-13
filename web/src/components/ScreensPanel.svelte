<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Screen } from '../../../shared/screen.ts';
  import { getAppContext } from '../lib/context.ts';
  import { formatDay } from '../lib/format.ts';
  import { createResource } from '../lib/resource.svelte.ts';
  import Icon from './Icon.svelte';

  // Télés de la maison avec l'appli HomeHub TV (tablette seulement) : l'appli affiche un code de 6 caractères au
  // premier lancement, un parent le tape ici avec le nom de la télé. Une télé n'appartient à personne et n'écrit rien ;
  // elle lit les messages vocaux des parents par-dessus ce qui passe. « Allumée » : l'appli a appelé il y a moins de
  // 40 s. Le retrait se confirme d'un second geste, par un parent.
  const SCREENS_REFRESH_MS = 15_000;

  const { api, actor, clock } = getAppContext();
  const screens = createResource(() => api.screens(), SCREENS_REFRESH_MS);
  onDestroy(screens.destroy);

  let code = $state('');
  let name = $state('Télé du salon');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let paired = $state<Screen | null>(null);
  let confirmRemove = $state<string | null>(null);
  let removeError = $state<string | null>(null);

  async function pair(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !code.trim() || !name.trim()) return;
    if (!(await actor.allow(null))) return;
    busy = true;
    error = null;
    paired = null;
    try {
      paired = await api.pairScreen(code.trim(), name.trim());
      code = '';
      await screens.refresh();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function askRemove(screen: Screen) {
    if (confirmRemove !== screen.id) {
      confirmRemove = screen.id;
      return;
    }
    confirmRemove = null;
    if (!(await actor.allow(null))) return;
    removeError = null;
    try {
      await api.removeScreen(screen.id);
    } catch (err) {
      removeError = (err as Error).message;
    } finally {
      await screens.refresh();
    }
  }
</script>

<section class="card screens">
  <h2><Icon name="tv" size={28} /> Télés</h2>
  <div class="columns">
    <form class="pair" onsubmit={pair}>
      <p class="muted">Ouvre l’appli HomeHub TV sur la télé, puis tape le code qu’elle affiche.</p>
      <div class="fields">
        <input class="code" bind:value={code} maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Code" aria-label="Code affiché sur la télé" />
        <input class="name" bind:value={name} maxlength="40" aria-label="Nom de la télé" />
        <button type="submit" class="primary" disabled={busy || !code.trim() || !name.trim()}>{busy ? 'Appairage…' : 'Appairer'}</button>
      </div>
      {#if paired}
        <p class="success"><Icon name="check" size={24} color="var(--ok)" strokeWidth={2.4} /> {paired.name} est appairée.</p>
      {:else if error}
        <p class="error">{error}</p>
      {/if}
    </form>

    <ul>
      {#each screens.data ?? [] as screen (screen.id)}
        <li>
          <span class="dot" class:on={screen.online} aria-hidden="true"></span>
          <span class="screen">
            <span class="screen-name">{screen.name}</span>
            <span class="muted small">
              {screen.online ? 'Allumée' : 'Éteinte ou appli fermée'}{screen.app ? ` · appli ${screen.app}` : ''}{screen.system ? ` · ${screen.system}` : ''} · vue {formatDay(new Date(screen.lastSeenAt), clock.now).toLowerCase()}
            </span>
          </span>
          <button type="button" class="remove" class:confirm={confirmRemove === screen.id} onclick={() => askRemove(screen)}>
            {confirmRemove === screen.id ? 'Confirmer' : 'Retirer'}
          </button>
        </li>
      {:else}
        {#if screens.data}<li class="muted">Aucune télé pour l’instant.</li>{/if}
      {/each}
      {#if screens.error}<li class="error">{screens.error}</li>{/if}
      {#if removeError}<li class="error">{removeError}</li>{/if}
    </ul>
  </div>
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px 28px;
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  h2 {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  p {
    margin: 0;
  }

  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }

  .pair {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .fields {
    display: flex;
    gap: 10px;
  }

  input {
    min-width: 0;
    min-height: 52px;
    padding: 0 14px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1.15rem;
  }

  .code {
    width: 8.5ch;
    flex-shrink: 0;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .name {
    flex: 1;
  }

  .primary {
    min-height: 52px;
    padding: 0 22px;
    border: 0;
    border-radius: 999px;
    background: var(--rain);
    color: var(--bg);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .primary:disabled {
    opacity: 0.5;
  }

  .muted {
    font-size: 1.1rem;
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.95rem;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 64px;
    border-bottom: 1px solid var(--surface-2);
  }

  li:last-child {
    border-bottom: 0;
  }

  .dot {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--border-strong);
  }

  .dot.on {
    background: var(--ok);
  }

  .screen {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .screen-name {
    font-size: 1.2rem;
    font-weight: 600;
  }

  .success {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 1.1rem;
    color: var(--ok-fg);
  }

  .remove {
    min-height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
  }

  .remove.confirm {
    background: var(--danger-bg);
    color: var(--danger-fg);
  }

  .error {
    color: var(--danger-fg);
  }
</style>
