<script lang="ts">
  import { onMount } from 'svelte';
  import Avatar from '../components/Avatar.svelte';
  import Icon from '../components/Icon.svelte';
  import { ApiError } from '../lib/api.ts';
  import { getAppContext } from '../lib/context.ts';
  import { deviceInfo, savePairing } from '../lib/phone.ts';
  import type { Profile } from '../lib/profiles.ts';
  import { phonePath } from '../lib/route.ts';

  // Ouverte en scannant le code de la tablette (/appairer#<code>) : le téléphone échange le code contre son jeton,
  // lié au profil choisi sur la tablette. Le code est retiré de l'adresse aussitôt lu.
  const { api, profiles, navigate } = getAppContext();

  let step = $state<'claiming' | 'done' | 'failed'>('claiming');
  let profile = $state<Profile | null>(null);
  let error = $state('');

  onMount(async () => {
    const code = location.hash.slice(1);
    history.replaceState(null, '', location.pathname);
    if (!code) {
      step = 'failed';
      error = 'Aucun code dans le lien. Scanne le code affiché sur la tablette.';
      return;
    }
    try {
      const info = await deviceInfo();
      const { token, device } = await api.claimPairing(code, info.name, info.system);
      savePairing({ token, ownerId: device.ownerId });
      profile = profiles.find((p) => p.id === device.ownerId) ?? null;
      step = 'done';
    } catch (err) {
      step = 'failed';
      error =
        err instanceof ApiError && err.status === 410
          ? 'Ce code a expiré ou a déjà servi. Affiche-en un nouveau sur la tablette.'
          : `Impossible de relier le téléphone : ${(err as Error).message}`;
    }
  });
</script>

<div class="pair">
  {#if step === 'claiming'}
    <p class="muted">Connexion à la tablette…</p>
  {:else if step === 'done' && profile}
    <Avatar {profile} size={112} />
    <h1>Bonjour {profile.name}</h1>
    <p>Ce téléphone est relié à ton profil. Les courses et les tâches que tu ajoutes ou coches le seront à ton nom.</p>
    <p class="muted small">Astuce : ajoute HomeHub à l’écran d’accueil pour le retrouver comme une appli, et partager vers lui.</p>
    <button type="button" class="primary" onclick={() => navigate(phonePath('shopping'))}>C’est parti</button>
  {:else}
    <Icon name="alert" size={64} color="var(--warn)" />
    <h1>Pas relié</h1>
    <p>{error}</p>
  {/if}
</div>

<style>
  .pair {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    height: 100dvh;
    max-width: 520px;
    margin: 0 auto;
    padding: 32px 24px;
    box-sizing: border-box;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
  }

  p {
    margin: 0;
    font-size: 1.15rem;
    line-height: 1.5;
    color: var(--fg-soft);
  }

  .muted {
    color: var(--fg-muted);
  }

  .small {
    font-size: 0.95rem;
  }

  .primary {
    align-self: stretch;
    min-height: 58px;
    margin-top: 12px;
    border: 0;
    border-radius: 18px;
    background: var(--rain);
    color: var(--bg);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 700;
  }
</style>
