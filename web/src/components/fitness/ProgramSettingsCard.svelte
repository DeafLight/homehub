<script lang="ts">
  import type { FitnessSettings } from '../../../../shared/fitness.ts';
  import SportCard from './SportCard.svelte';

  // Réglages du programme (onglet Sport) : matériel (élastique de tirage) et « sans sauts ». Chaque case s'enregistre
  // tout de suite ; la prochaine séance affichée au-dessus change en conséquence.
  type Props = { settings: FitnessSettings; busy: boolean; onSave: (settings: FitnessSettings) => void };
  let { settings, busy, onSave }: Props = $props();
</script>

<SportCard label="Réglages du programme">
  <h2>Réglages du programme</h2>
  <label class="check">
    <input type="checkbox" checked={settings.band} disabled={busy} onchange={(e) => onSave({ ...settings, band: e.currentTarget.checked })} />
    <span>
      <strong>Élastique de tirage</strong>
      <span class="small">Fixé à une porte : l’exercice de dos de chaque séance devient un rowing à l’élastique.</span>
    </span>
  </label>
  <label class="check">
    <input type="checkbox" checked={settings.noJump} disabled={busy} onchange={(e) => onSave({ ...settings, noJump: e.currentTarget.checked })} />
    <span>
      <strong>Sans sauts</strong>
      <span class="small">Burpees, squats sautés, fentes sautées, patineurs… remplacés dès le départ par leur version sans impact.</span>
    </span>
  </label>
</SportCard>

<style>
  .check {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 8px 0;
  }

  .check input {
    flex: none;
    width: 22px;
    height: 22px;
    margin: 2px 0 0;
  }

  .check > span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .small {
    color: var(--fg-muted);
    font-size: 0.88rem;
  }
</style>
