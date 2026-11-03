// Racine de composition du front : crée les services partagés et les fournit à l'application par le contexte.
import { mount } from 'svelte';
import App from './App.svelte';
import { createApi } from './lib/api.ts';
import { createClock } from './lib/clock.svelte.ts';
import { appContextMap } from './lib/context.ts';
import { loadPairing } from './lib/phone.ts';
import { buildProfiles } from './lib/profiles.ts';
import { createRouter } from './lib/router.svelte.ts';
import './app.css';

const CONFIG_RETRY_MS = 10_000;
const target = document.getElementById('app')!;
// Sur un téléphone relié, chaque requête porte son jeton ; la tablette n'en a pas.
const api = createApi(undefined, '/api', () => loadPairing()?.token ?? null);

// La config (membres, réglages) est nécessaire avant tout affichage : on réessaie tant que le serveur ne répond pas.
async function start() {
  try {
    const config = await api.config();
    const router = createRouter();
    target.textContent = '';
    target.className = '';
    mount(App, {
      target,
      context: appContextMap({
        api,
        config,
        profiles: buildProfiles(config),
        clock: createClock(),
        router,
        navigate: router.navigate,
      }),
    });
  } catch (err) {
    target.textContent = `Connexion au serveur impossible (${(err as Error).message}). Nouvel essai dans quelques secondes…`;
    target.className = 'boot-error';
    setTimeout(start, CONFIG_RETRY_MS);
  }
}

void start();
