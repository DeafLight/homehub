// Entrée de la page de la séance de sport sur la télé (web/tele-sport.html) : le jeton de la télé est lu dans le
// fragment puis retiré de l'adresse, et la page n'a besoin de rien d'autre (ni config, ni tablette, ni téléphone).
import { mount } from 'svelte';
import { tokenFromHash } from './lib/tele-sport.ts';
import TeleSport from './tele/TeleSport.svelte';
import './app.css';

const token = tokenFromHash(location.hash);
history.replaceState(null, '', location.pathname);
mount(TeleSport, { target: document.getElementById('app')!, props: { token } });
