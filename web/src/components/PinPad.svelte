<script lang="ts">
  import type { Profile } from '../lib/profiles.ts';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  // Saisie d'un code sur la tablette : PIN d'un profil avant d'afficher le QR code qui relie un téléphone à ce profil,
  // ou PIN du propriétaire / code parent avant de retirer un téléphone. Les chiffres ne sont jamais affichés,
  // seulement des points.
  const MIN = 4;
  const MAX = 8;

  type Props = {
    /** Profil concerné (absent : téléphone d'un profil disparu de la configuration). */
    profile?: Profile;
    /** Titre : le prénom du profil par défaut. */
    title?: string;
    hint?: string;
    error: string | null;
    /** Vrai si le PIN est accepté ; sinon la saisie est effacée. */
    onSubmit(pin: string): Promise<boolean>;
    onCancel(): void;
  };
  let { profile, title = profile?.name ?? '', hint = 'Code PIN', error, onSubmit, onCancel }: Props = $props();

  let pin = $state('');
  let busy = $state(false);
  // L'erreur s'efface dès qu'on recommence à taper.
  const shownError = $derived(pin.length === 0 ? error : null);

  const press = (digit: string) => {
    if (pin.length < MAX) pin += digit;
  };

  async function submit() {
    if (pin.length < MIN || busy) return;
    busy = true;
    try {
      if (!(await onSubmit(pin))) pin = '';
    } finally {
      busy = false;
    }
  }
</script>

<div class="pin">
  {#if profile}<Avatar {profile} size={64} />{/if}
  <h2>{title}</h2>
  <span class="hint">{hint}</span>
  <div class="dots" aria-label="{pin.length} chiffres saisis">
    {#each { length: Math.max(MIN, pin.length) }, i (i)}
      <span class="dot" class:filled={i < pin.length}></span>
    {/each}
  </div>
  <p class="error" role="alert">{shownError ?? ''}</p>

  <div class="keys">
    {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as digit (digit)}
      <button type="button" onclick={() => press(digit)}>{digit}</button>
    {/each}
    <button type="button" class="soft" aria-label="Effacer" onclick={() => (pin = pin.slice(0, -1))}>
      <Icon name="back" size={28} strokeWidth={2.2} />
    </button>
    <button type="button" onclick={() => press('0')}>0</button>
    <button type="button" class="ok" aria-label="Valider" disabled={pin.length < MIN || busy} onclick={submit}>
      <Icon name="check" size={30} strokeWidth={2.6} />
    </button>
  </div>

  <button type="button" class="cancel" onclick={onCancel}>Annuler</button>
</div>

<style>
  .pin {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .hint {
    margin-top: -8px;
    color: var(--fg-muted);
  }

  .dots {
    display: flex;
    gap: 14px;
    min-height: 22px;
    margin-top: 4px;
  }

  .dot {
    width: 18px;
    height: 18px;
    border: 2px solid var(--fg-muted);
    border-radius: 50%;
  }

  .dot.filled {
    border-color: var(--fg);
    background: var(--fg);
  }

  .error {
    min-height: 1.4em;
    margin: 0;
    font-size: 1.05rem;
    color: var(--danger-fg);
  }

  .keys {
    display: grid;
    grid-template-columns: repeat(3, 84px);
    gap: 12px;
  }

  .keys button {
    display: grid;
    height: 72px;
    place-items: center;
    border: 0;
    border-radius: 20px;
    background: var(--surface-2);
    color: var(--fg);
    font: inherit;
    font-size: 1.8rem;
    font-weight: 600;
  }

  .keys button:active {
    background: var(--border-strong);
  }

  .keys .soft {
    background: none;
    color: var(--fg-muted);
  }

  .keys .ok {
    background: var(--rain);
    color: var(--bg);
  }

  .keys .ok:disabled {
    opacity: 0.4;
  }

  .cancel {
    min-height: 48px;
    padding: 0 24px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--fg-muted);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 600;
  }
</style>
