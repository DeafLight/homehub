<script lang="ts">
  import { untrack } from 'svelte';
  import { type DriveView, ENSEIGNES, type Enseigne, enseigneName } from '../../../../shared/drive.ts';
  import type { Api } from '../../lib/api.ts';
  import Icon from '../Icon.svelte';

  // Réglages du drive : l'enseigne (Courses U pour l'instant) et le magasin de retrait (un nom, et si on veut le lien
  // de sa page chez l'enseigne). Un parent seulement : le serveur refuse les autres, le message s'affiche ici. Le
  // créneau et le paiement se font toujours dans l'appli de l'enseigne.
  type Props = { api: Api; view: DriveView; onSaved: (view: DriveView) => void; onClose: () => void };
  let { api, view, onSaved, onClose }: Props = $props();

  let enseigne = $state<Enseigne | null>(untrack(() => view.settings.enseigne));
  let storeName = $state(untrack(() => view.settings.store?.name ?? ''));
  let storeUrl = $state(untrack(() => view.settings.store?.url ?? ''));
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      const name = storeName.trim();
      const url = storeUrl.trim() || null;
      onSaved(await api.saveDriveSettings({ enseigne, store: name || url ? { name, url } : null }));
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<form class="settings" onsubmit={save}>
  <h2><Icon name="cart" size={26} /> Drive</h2>
  <p class="muted">Pour chaque article des courses, on retient un produit de l’enseigne. Le créneau et le paiement se font dans son appli.</p>

  <fieldset>
    <legend class="muted">Enseigne</legend>
    <div class="choices">
      <button type="button" class="btn" class:primary={enseigne === null} onclick={() => (enseigne = null)}>Aucune</button>
      {#each ENSEIGNES as option (option)}
        <button type="button" class="btn" class:primary={enseigne === option} onclick={() => (enseigne = option)}>{enseigneName(option)}</button>
      {/each}
    </div>
  </fieldset>

  {#if enseigne}
    <label><span class="muted">Magasin de retrait</span><input bind:value={storeName} maxlength="80" placeholder="Super U de mon quartier" /></label>
    <label><span class="muted">Lien de la page du magasin (facultatif)</span><input type="url" inputmode="url" bind:value={storeUrl} placeholder="https://www.coursesu.com/…" /></label>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
  <div class="actions">
    <button type="submit" class="btn primary" disabled={busy}><Icon name="check" size={22} /> Enregistrer</button>
    <button type="button" class="btn" onclick={onClose}>Fermer</button>
  </div>
</form>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: var(--text-title);
  }

  p {
    margin: 0;
  }

  .muted {
    color: var(--fg-muted);
  }

  .error {
    color: var(--danger-fg);
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0 0 var(--space-1);
  }

  .choices,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  input {
    min-height: 52px;
    padding: 0 16px;
    border: 2px solid var(--surface-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, 1.1rem);
    user-select: text;
  }
</style>
