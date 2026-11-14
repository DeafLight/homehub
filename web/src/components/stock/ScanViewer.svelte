<script lang="ts">
  import { canDetectBarcodes } from '../../lib/barcode-camera.ts';
  import type { Facing, Flash, ScanMode } from '../../lib/scan.ts';
  import Icon from '../Icon.svelte';

  // Image de la caméra du scanner : cadre à viser et consigne, ou, une fois un code lu, l'éclair puis le bandeau du
  // produit (et « Retire le produit » tant qu'il est devant la caméra). Bouton pour changer de caméra. Téléphone :
  // l'image tient en un bandeau, bandeau du produit sur deux lignes au plus, bouton du code à la main (clavier).
  type Props = {
    video?: HTMLVideoElement;
    facing: Facing;
    cameraState: 'starting' | 'on' | 'error';
    cameraMessage: string;
    /** Bandeau à afficher, ou null (cadre à viser). */
    flash: Flash | null;
    /** Le produit lu est encore devant la caméra (et aucune question n'est posée). */
    remove: boolean;
    mode: ScanMode;
    phone: boolean;
    onSwitch: () => void;
    /** Téléphone : déplier ou replier le champ du code à la main. */
    onManual?: () => void;
    manualOpen?: boolean;
  };
  let { video = $bindable(), facing, cameraState, cameraMessage, flash, remove, mode, phone, onSwitch, onManual, manualOpen = false }: Props = $props();
</script>

<div class="viewer {flash ? `hold ${flash.tone}` : ''}" class:phone>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} playsinline muted class:mirror={facing === 'user'}></video>
  {#if cameraState !== 'on'}
    <div class="message">{cameraState === 'starting' ? 'Ouverture de la caméra…' : cameraMessage}</div>
  {:else if !canDetectBarcodes}
    <div class="message">Ce navigateur ne lit pas les codes-barres : saisis le code à la main.</div>
  {/if}
  {#if flash}
    <!-- Code lu : éclair, puis bandeau tant que le produit est devant la caméra. -->
    {#key flash}<div class="flash {flash.tone}" aria-hidden="true"></div>{/key}
    <div class="band {flash.tone}" role="status">
      <Icon name={flash.tone === 'error' ? 'alert' : flash.tone === 'ask' ? 'message' : 'check'} size={phone ? 26 : 36} strokeWidth={2.4} />
      <span class="band-text">
        <strong>{flash.title}</strong>
        {#if flash.info}<span class="band-info">{flash.info}</span>{/if}
        {#if flash.detail}<span>{flash.detail}</span>{/if}
      </span>
      {#if remove}<span class="remove">{phone ? 'Retire-le' : 'Retire le produit'}</span>{/if}
    </div>
  {:else}
    {#if !phone || cameraState === 'on'}<div class="guide" aria-hidden="true"></div>
    <div class="hint">{mode === 'in' ? 'Présente le code-barres d’un produit à ranger' : 'Présente le code-barres du paquet vide'}</div>{/if}
  {/if}
  <div class="tools">
    {#if onManual}
      <button type="button" class:on={manualOpen} aria-label="Code-barres à la main" aria-pressed={manualOpen} onclick={onManual}>
        <Icon name="keyboard" size={phone ? 22 : 26} />
      </button>
    {/if}
    <button type="button" aria-label="Changer de caméra" onclick={onSwitch}>
      <Icon name="refresh" size={phone ? 22 : 26} />
    </button>
  </div>
</div>

<style>
  .viewer {
    position: relative;
    overflow: hidden;
    border: 6px solid transparent;
    border-radius: var(--radius-lg);
    background: #000;
    transition: border-color 0.15s;
  }

  .viewer.phone .hint,
  .viewer.phone .message {
    font-size: var(--text-label);
  }

  /* Produit lu, à retirer : bordure de couleur qui pulse. */
  .viewer.hold {
    animation: pulse 1s ease-in-out infinite;
  }

  .viewer.hold.ok {
    border-color: var(--ok);
  }

  .viewer.hold.ask {
    border-color: var(--warn);
  }

  .viewer.hold.error {
    border-color: var(--bad);
  }

  @keyframes pulse {
    50% {
      border-color: transparent;
    }
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  video.mirror {
    transform: scaleX(-1);
  }

  .guide {
    position: absolute;
    inset: 28% 14%;
    border: 3px dashed rgb(255 255 255 / 0.7);
    border-radius: var(--radius-md);
  }

  .hint,
  .message {
    position: absolute;
    left: 50%;
    max-width: 90%;
    transform: translateX(-50%);
    padding: 10px 18px;
    border-radius: 999px;
    background: rgb(15 17 21 / 0.8);
    font-size: var(--text-body);
    text-align: center;
  }

  .hint {
    top: var(--space-2);
  }

  .message {
    top: 45%;
    border-radius: var(--radius-md);
  }

  .flash {
    position: absolute;
    inset: 0;
    animation: flash 0.45s ease-out forwards;
    pointer-events: none;
  }

  .flash.ok {
    background: var(--ok);
  }

  .flash.ask {
    background: var(--warn);
  }

  .flash.error {
    background: var(--bad);
  }

  @keyframes flash {
    from {
      opacity: 0.75;
    }
    to {
      opacity: 0;
    }
  }

  .band {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: var(--space-2);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--bg);
  }

  .band.ok {
    background: var(--ok);
  }

  .band.ask {
    background: var(--warn);
  }

  .band.error {
    background: var(--bad);
  }

  .band-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    font-size: var(--text-body);
  }

  /* Nom long : sur deux lignes au plus, plutôt que coupé à la première. */
  .band-text strong {
    display: -webkit-box;
    overflow: hidden;
    font-size: var(--text-title);
    line-height: 1.2;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .band-info {
    font-weight: 600;
  }

  /* L'invitation à retirer le produit : ce qui évite les doublons. */
  .remove {
    padding: 10px 18px;
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font-size: var(--text-body);
    font-weight: 700;
    animation: nudge 0.9s ease-in-out infinite;
  }

  /* Téléphone : texte plus petit, une information par ligne, l'invitation à retirer le produit en dessous. */
  .viewer.phone .band {
    left: 8px;
    right: 8px;
    bottom: 8px;
    flex-wrap: nowrap;
    gap: var(--space-1);
    padding: 8px 12px;
  }

  .viewer.phone .band-text > * {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .viewer.phone .band-text strong {
    display: block;
  }

  .viewer.phone .band-text {
    flex-basis: 0;
    font-size: var(--text-label);
  }

  .viewer.phone .band-text strong {
    font-size: var(--text-body);
  }

  .viewer.phone .remove {
    flex: none;
    padding: 6px 12px;
    font-size: var(--text-small);
  }

  @keyframes nudge {
    50% {
      transform: translateY(-6px);
    }
  }

  .tools {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    gap: var(--space-1);
  }

  .tools button {
    display: grid;
    width: 56px;
    height: 56px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: rgb(15 17 21 / 0.75);
    color: var(--fg);
  }

  .tools button.on {
    background: var(--rain);
    color: var(--bg);
  }

  /* Téléphone, image en bandeau : consigne à gauche des boutons, cadre plus large que haut, tout plus petit. */
  .viewer.phone {
    border-width: 4px;
  }

  .viewer.phone .tools {
    top: 8px;
    right: 8px;
  }

  .viewer.phone .tools button {
    width: 44px;
    height: 44px;
  }

  .viewer.phone .hint {
    top: 8px;
    left: 8px;
    max-width: calc(100% - 128px);
    padding: 6px 12px;
    transform: none;
    border-radius: var(--radius-md);
    text-align: left;
  }

  .viewer.phone .message {
    top: 50%;
    max-width: 80%;
    transform: translate(-50%, -50%);
  }

  .viewer.phone .guide {
    inset: 40% 18% 14%;
  }
</style>
