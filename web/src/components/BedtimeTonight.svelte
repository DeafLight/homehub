<script lang="ts">
  import type { BedtimeView } from '../../../shared/bedtime.ts';
  import { getAppContext } from '../lib/context.ts';
  import { tonightActions, tonightLine } from '../lib/bedtime.ts';
  import Icon from './Icon.svelte';

  // Coucher de ce soir (tablette sous les réglages, téléphone d'un parent dans la télécommande) : où il en est, et les
  // gestes d'un parent : repousser d'un quart d'heure, annuler pour ce soir, rétablir. Le serveur vérifie les droits ;
  // `allow` demande d'abord qui agit à la tablette (parent reconnu), `check` traite une erreur de droits.
  type Props = {
    view: BedtimeView;
    onchange: (view: BedtimeView) => void;
    allow?: () => Promise<boolean>;
    check?: (err: unknown) => void;
    compact?: boolean;
  };
  let { view, onchange, allow = async () => true, check = () => {}, compact = false }: Props = $props();
  const { api } = getAppContext();

  const line = $derived(tonightLine(view.settings, view.tonight));
  const actions = $derived(tonightActions(view.tonight));
  let busy = $state(false);
  let feedback = $state<{ text: string; ok: boolean } | null>(null);

  const DONE = { postpone: 'Coucher repoussé', cancel: 'Coucher annulé pour ce soir', restore: 'Coucher rétabli' } as const;

  async function act(action: 'postpone' | 'cancel' | 'restore') {
    if (busy || !(await allow())) return;
    busy = true;
    feedback = null;
    try {
      const result = await api.bedtimeTonight(action);
      onchange(result);
      feedback = { text: result.screens ? `${DONE[action]} : la télé l’affiche` : `${DONE[action]} (aucune télé allumée)`, ok: true };
    } catch (err) {
      check(err);
      feedback = { text: (err as Error).message, ok: false };
    } finally {
      busy = false;
    }
  }
</script>

<div class="tonight" class:compact>
  <div class="line">
    <Icon name="moon" size={compact ? 24 : 28} />
    <span class="what">
      <span class="text">{line.text}</span>
      {#if line.detail}<span class="muted">{line.detail}</span>{/if}
    </span>
  </div>
  {#if actions.postpone || actions.cancel || actions.restore}
    <div class="buttons">
      {#if actions.postpone}<button type="button" disabled={busy} onclick={() => act('postpone')}>Repousser {actions.postpone}</button>{/if}
      {#if actions.cancel}<button type="button" disabled={busy} onclick={() => act('cancel')}>Annuler ce soir</button>{/if}
      {#if actions.restore}<button type="button" disabled={busy} onclick={() => act('restore')}>Rétablir l’heure prévue</button>{/if}
    </div>
  {/if}
  {#if feedback}<p class="small" class:ok={feedback.ok} class:error={!feedback.ok} role="status">{feedback.text}</p>{/if}
</div>

<style>
  .tonight {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 18px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 14px;
    color: var(--sun);
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    color: var(--fg);
  }

  .text {
    font-size: 1.2rem;
    font-weight: 600;
  }

  .compact .text {
    font-size: 1.05rem;
  }

  .muted {
    font-size: 1rem;
    color: var(--fg-muted);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  button {
    min-height: 44px;
    padding: 0 18px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
  }

  button:disabled {
    opacity: 0.5;
  }

  p {
    margin: 0;
  }

  .small {
    font-size: 0.95rem;
  }

  .ok {
    color: var(--ok-fg);
  }

  .error {
    color: var(--danger-fg);
  }
</style>
