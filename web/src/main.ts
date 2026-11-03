// Racine de composition du front : crée les services partagés et les fournit à l'application par le contexte.
import { mount } from 'svelte';
import App from './App.svelte';
import { type Actor, createActor } from './lib/actor.svelte.ts';
import { createApi } from './lib/api.ts';
import { createClock } from './lib/clock.svelte.ts';
import { appContextMap } from './lib/context.ts';
import { loadKioskKey, takeKioskKeyFromUrl } from './lib/kiosk.ts';
import { loadPairing } from './lib/phone.ts';
import { buildProfiles } from './lib/profiles.ts';
import { createRouter } from './lib/router.svelte.ts';
import './app.css';

const CONFIG_RETRY_MS = 10_000;
const target = document.getElementById('app')!;
// Chaque requête porte le jeton du téléphone relié, ou la clé de la tablette (lue une fois dans #key=…) et la session
// de la personne reconnue devant elle.
takeKioskKeyFromUrl();
let actor: Actor | undefined;
const api = createApi(
  undefined,
  '/api',
  () => ({ token: loadPairing()?.token, kioskKey: loadKioskKey(), actor: actor?.token() }),
  (err) => actor?.check(err),
);
/** La tablette se reconnaît à sa clé ou à son adresse : seul le serveur le sait. */
let kiosk: Promise<boolean> | null = null;
const isKiosk = () =>
  (kiosk ??= api.me().then(
    (me) => me.kiosk,
    () => ((kiosk = null), false),
  ));

// La config (membres, réglages) est nécessaire avant tout affichage : on réessaie tant que le serveur ne répond pas.
async function start() {
  try {
    const config = await api.config();
    actor = createActor({ config, isKiosk, endSession: api.endFaceSession });
    const router = createRouter();
    target.textContent = '';
    target.className = '';
    mount(App, {
      target,
      context: appContextMap({
        api,
        actor,
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
