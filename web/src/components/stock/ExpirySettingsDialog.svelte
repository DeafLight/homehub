<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { EXPIRY_LIMITS } from '../../../../shared/expiry.ts';
  import type { ExpirySettings, StockSettings } from '../../../../shared/types.ts';
  import { ApiError } from '../../lib/api.ts';
  import { createAutoSave, requireParent, type SaveState } from '../../lib/autosave.ts';
  import { getAppContext } from '../../lib/context.ts';
  import { STOCK_CATEGORIES } from '../../lib/stock.ts';
  import Icon from '../Icon.svelte';
  import SaveStatus from '../SaveStatus.svelte';
  import Modal from './Modal.svelte';

  // Réglage des dates de péremption (page Stock de la tablette) : seuils (DLC bientôt, urgente ; DDM bientôt) et
  // durée d'un produit sans date imprimée, rayon par rayon (« pas d'estimation » : aucune date devinée). Enregistré de
  // lui-même (lib/autosave.ts) ; tout le monde regarde, seul un parent reconnu enregistre.
  type Props = { settings: ExpirySettings; onSaved: (settings: StockSettings) => void; onClose: () => void };
  let { settings, onSaved, onClose }: Props = $props();

  const { api, actor } = getAppContext();
  let draft = $state<ExpirySettings>(untrack(() => structuredClone($state.snapshot(settings))));
  let saved = untrack(() => structuredClone($state.snapshot(settings)));
  let saveState = $state<SaveState>({ kind: 'idle' });

  const auto = createAutoSave({
    onState: (next) => (saveState = next),
    async save() {
      const sent = $state.snapshot(draft);
      if (JSON.stringify(sent) === JSON.stringify(saved)) return false;
      await requireParent(actor, 'Seul un parent peut régler les dates');
      try {
        const next = await api.saveExpirySettings(sent);
        saved = structuredClone(next.expiry);
        onSaved(next);
      } catch (err) {
        actor.check(err);
        throw new Error(err instanceof ApiError ? err.message : 'Enregistrement impossible');
      }
      return true;
    },
  });
  onDestroy(() => void auto.flush());

  type Threshold = 'soonDlcDays' | 'urgentDlcDays' | 'soonDdmDays';
  const THRESHOLDS: { key: Threshold; label: string; hint: string; max: number }[] = [
    { key: 'urgentDlcDays', label: 'DLC urgente', hint: 'accueil, menu', max: EXPIRY_LIMITS.threshold },
    { key: 'soonDlcDays', label: 'DLC bientôt', hint: 'filtre « À consommer »', max: EXPIRY_LIMITS.threshold },
    { key: 'soonDdmDays', label: 'DDM bientôt', hint: 'filtre « À consommer »', max: EXPIRY_LIMITS.keep },
  ];

  function step(key: Threshold, delta: number, max: number) {
    draft[key] = Math.min(max, Math.max(0, draft[key] + delta));
    auto.touch('thresholds');
  }

  function stepRayon(rayon: string, delta: number) {
    const current = draft.defaults[rayon] ?? 0;
    const next = Math.min(EXPIRY_LIMITS.keep, current + delta);
    if (next <= 0) delete draft.defaults[rayon];
    else draft.defaults[rayon] = next;
    auto.touch('rayons');
  }

  const rayons = $derived([...new Set([...STOCK_CATEGORIES, ...Object.keys(draft.defaults)])]);
  const days = (n: number) => `${n} jour${n > 1 ? 's' : ''}`;
</script>

<Modal label="Dates de péremption" {onClose} wide>
  <header>
    <h2>Dates de péremption</h2>
    <span class="muted"><Icon name="lock" size={20} /> {actor.current?.parent ? `${actor.current.name} peut modifier` : 'Seul un parent peut modifier'}</span>
  </header>

  <section>
    <div class="title"><h3 class="card-label">Seuils</h3><SaveStatus state={saveState} zone="thresholds" /></div>
    {#each THRESHOLDS as t (t.key)}
      <div class="line">
        <span><strong>{t.label}</strong> <span class="muted">· {t.hint}</span></span>
        <span class="stepper">
          <button type="button" class="round" aria-label="Un jour de moins" disabled={draft[t.key] <= 0} onclick={() => step(t.key, -1, t.max)}><Icon name="minus" size={20} /></button>
          <span class="value">{draft[t.key] === 0 ? 'le jour même' : `${days(draft[t.key])} ou moins`}</span>
          <button type="button" class="round" aria-label="Un jour de plus" disabled={draft[t.key] >= t.max} onclick={() => step(t.key, 1, t.max)}><Icon name="plus" size={20} /></button>
        </span>
      </div>
    {/each}
  </section>

  <section>
    <div class="title"><h3 class="card-label">Sans date imprimée : date estimée</h3><SaveStatus state={saveState} zone="rayons" /></div>
    <p class="muted small">Entrée + durée du rayon, montrée « ≈ estimé » (jamais rouge, jamais sur l’accueil). Chaque produit peut avoir sa propre durée (sa fiche).</p>
    <div class="rayons">
      {#each rayons as rayon (rayon)}
        {@const value = draft.defaults[rayon] ?? 0}
        <div class="line">
          <strong>{rayon}</strong>
          <span class="stepper">
            <button type="button" class="round" aria-label="Un jour de moins" disabled={value <= 0} onclick={() => stepRayon(rayon, -1)}><Icon name="minus" size={20} /></button>
            <span class="value" class:muted={!value}>{value ? days(value) : 'pas d’estimation'}</span>
            <button type="button" class="round" aria-label="Un jour de plus" onclick={() => stepRayon(rayon, 1)}><Icon name="plus" size={20} /></button>
          </span>
        </div>
      {/each}
    </div>
  </section>

  <div class="end"><button type="button" class="btn" onclick={onClose}>Fermer</button></div>
</Modal>

<style>
  header,
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
  }

  h2 {
    margin: 0;
    font-size: var(--text-title);
  }

  h3 {
    margin: 0;
  }

  .muted {
    color: var(--fg-muted);
  }

  .small {
    margin: 0;
    font-size: var(--text-small);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .rayons {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 4px var(--space-3);
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
    min-height: 52px;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .round {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
  }

  .round:disabled {
    opacity: 0.4;
  }

  .value {
    min-width: 9ch;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .end {
    display: flex;
    justify-content: flex-end;
  }
</style>
