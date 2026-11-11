<script lang="ts">
  import { untrack } from 'svelte';
  import { parsePantry } from '../../lib/menu.ts';

  // Placards toujours ignorés par les courses du menu (sel, poivre, huile, eau…), réglés une fois : un nom couvre
  // ses variantes (« huile » couvre « huile d'olive »).
  type Props = { names: string[]; busy: boolean; onSave: (names: string[]) => void; onCancel: () => void };
  let { names, busy, onSave, onCancel }: Props = $props();
  let text = $state(untrack(() => names.join(', ')));
</script>

<form class="pantry" onsubmit={(e) => (e.preventDefault(), onSave(parsePantry(text)))}>
  <h2>Placards</h2>
  <p class="muted">Toujours à la maison, jamais ajouté aux courses. Sépare par des virgules ; « huile » couvre aussi l’huile d’olive.</p>
  <textarea bind:value={text} rows="3" aria-label="Placards" placeholder="sel, poivre, huile, eau"></textarea>
  <div class="actions">
    <button type="button" class="btn" onclick={onCancel}>Annuler</button>
    <button type="submit" class="btn primary" disabled={busy}>Enregistrer</button>
  </div>
</form>

<style>
  .pantry {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  p {
    margin: 0;
  }

  textarea {
    padding: 14px 16px;
    border: 2px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: max(16px, var(--text-body));
    resize: vertical;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-1);
  }

  .muted {
    color: var(--fg-muted);
  }
</style>
