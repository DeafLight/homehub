// Fausse appli HomeHub TV du monde fictif : elle fait ce que fait l'appli sur la télé (tv-app/), avec le jeton de la
// télé fictive écrit dans screens.json par docs-captures.ts : attente longue des événements, téléchargement du message
// vocal, compte rendu « lecture commencée ». Le dernier message reçu va dans fake-screen.json (dossier d'état) ; les
// captures en font une maquette d'écran de télé : un programme inventé, et le bandeau de l'appli par-dessus.
// Télécommande : elle envoie son état (écran allumé, appli au premier plan, injecteur prêt) et ses applis inventées
// (fake-banners.ts), reçoit touches, texte, lancement et marche/arrêt, en tient compte (appli lancée, veille) et le
// note dans fake-screen-remote.json. Message écrit : gardé dans fake-screen-text.json, compte rendu « affiché » ; les
// captures en font la maquette du bandeau de l'appli.
// Minuteur terminé (fonction 3) : l'alerte reçue va dans fake-screen-timer.json (retirée quand le minuteur est
// arrêté), pour la maquette du bandeau « Arrêter ».
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCREEN_PROTOCOL, SCREEN_PROTOCOL_HEADER, type ScreenEvent, type ScreenEvents, type ScreenStateReport } from '../../shared/screen.ts';
import { fakeScreenApps } from './fake-banners.ts';

export const FAKE_SCREEN_TOKEN = 'docs-tele';
export const FAKE_SCREEN_ID = 'docs-tele';
export const FAKE_SCREEN_FILE = 'fake-screen.json';
export const FAKE_SCREEN_REMOTE_FILE = 'fake-screen-remote.json';
export const FAKE_SCREEN_TEXT_FILE = 'fake-screen-text.json';
export const FAKE_SCREEN_TIMER_FILE = 'fake-screen-timer.json';

/** Ce que la fausse télé a reçu : le titre du bandeau et la taille du message. */
export type FakeScreenMessage = { title: string; bytes: number };
/** Message écrit reçu : titre, texte et durée du bandeau. */
export type FakeScreenText = { title: string; text: string; seconds: number };
/** Alerte de minuteur affichée par la fausse télé : de quoi dessiner le bandeau, et le minuteur à arrêter. */
export type FakeScreenTimer = { timerId: string; title: string; subtitle: string };
/** Ordres de la télécommande reçus, en clair (« touches : bas bas ok »), et l'état qui en résulte. */
export type FakeScreenRemote = { received: string[]; screenOn: boolean; foreground: string };

/** Ce que fait la fausse télé d'un ordre de la télécommande : la ligne du journal, et l'état qui change. */
export function applyRemote(event: ScreenEvent, state: ScreenStateReport): string | null {
  switch (event.kind) {
    case 'key':
      return `touches : ${event.keys.join(' ')}${event.notice ? ` (bandeau « ${event.notice.title} »)` : ''}`;
    case 'text':
      return `texte : ${event.text}${event.submit ? ' ⏎' : ''}`;
    case 'launch':
      state.foreground = event.package;
      return `appli : ${event.package}`;
    case 'power':
      state.screenOn = event.on;
      return event.on ? 'allumer' : 'veille';
    default:
      return null;
  }
}

/** Démarre la fausse appli contre le serveur `base` (http://127.0.0.1:port) ; elle tourne jusqu'à la fin du processus. */
export function startFakeScreen(base: string) {
  const headers = { Authorization: `Bearer ${FAKE_SCREEN_TOKEN}`, [SCREEN_PROTOCOL_HEADER]: String(SCREEN_PROTOCOL) };
  const post = (method: string, path: string, body: unknown) =>
    fetch(`${base}${path}`, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const dir = process.env.HOMEHUB_STATE_DIR ?? '.';
  const state: ScreenStateReport = { screenOn: true, foreground: 'fr.exemple.video', control: 'adb', addresses: ['127.0.0.1'] };
  const remote: FakeScreenRemote = { received: [], screenOn: true, foreground: state.foreground! };
  let after: number | null = null;
  let introduced = false;
  const loop = async (): Promise<void> => {
    try {
      if (!introduced) {
        // Comme l'appli à son démarrage : son état, puis la liste des applis du lanceur.
        introduced = (await post('POST', '/api/screen/state', state)).ok && (await post('PUT', '/api/screen/apps', { apps: fakeScreenApps() })).ok;
      }
      const res = await fetch(`${base}/api/screen/events${after === null ? '' : `?after=${after}`}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { events, last } = (await res.json()) as ScreenEvents;
      after = last;
      for (const event of events) {
        if (event.kind === 'message') {
          writeFileSync(join(dir, FAKE_SCREEN_TEXT_FILE), JSON.stringify({ title: event.title, text: event.text, seconds: event.seconds } satisfies FakeScreenText));
          console.log(`Fausse appli HomeHub TV, message écrit : ${event.title}, « ${event.text} »`);
          await post('POST', `/api/screen/events/${event.id}/report`, { ok: true });
          continue;
        }
        if (event.kind === 'timer' || event.kind === 'timer-clear') {
          // Comme MinuteurAlertes (tv-app) : bandeau affiché ou retiré, compte rendu.
          if (event.kind === 'timer') writeFileSync(join(dir, FAKE_SCREEN_TIMER_FILE), JSON.stringify({ timerId: event.timerId, title: event.title, subtitle: event.subtitle } satisfies FakeScreenTimer));
          else rmSync(join(dir, FAKE_SCREEN_TIMER_FILE), { force: true });
          await post('POST', `/api/screen/events/${event.id}/report`, { ok: true });
          console.log(`Fausse appli HomeHub TV, minuteur : ${event.kind === 'timer' ? `${event.title}, ${event.subtitle}` : 'arrêté, bandeau retiré'}`);
          continue;
        }
        if (event.kind !== 'voice') {
          const line = applyRemote(event, state);
          await post('POST', `/api/screen/events/${event.id}/report`, { ok: true });
          if (event.kind === 'launch' || event.kind === 'power') await post('POST', '/api/screen/state', state);
          if (line) {
            remote.received.push(line);
            Object.assign(remote, { screenOn: state.screenOn, foreground: state.foreground });
            writeFileSync(join(dir, FAKE_SCREEN_REMOTE_FILE), JSON.stringify(remote));
            console.log(`Fausse appli HomeHub TV, télécommande : ${line}`);
          }
          continue;
        }
        const clip = await fetch(`${base}${event.audio}`, { headers });
        const bytes = clip.ok ? (await clip.arrayBuffer()).byteLength : 0;
        writeFileSync(join(dir, FAKE_SCREEN_FILE), JSON.stringify({ title: event.title, bytes } satisfies FakeScreenMessage));
        console.log(`Fausse appli HomeHub TV : ${event.title}, ${bytes} octets`);
        await post('POST', `/api/screen/events/${event.id}/report`, clip.ok ? { ok: true } : { ok: false, reason: `message introuvable (HTTP ${clip.status})` });
      }
    } catch {
      // Serveur pas encore prêt : on réessaie un peu plus tard.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return loop();
  };
  void loop();
}

const escape = (s: string) => s.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Maquette d'écran de télé (1280×720) : le programme continue, le bandeau de l'appli en haut à droite (icône micro,
 * titre, barres de niveau), couleurs du thème sombre de HomeHub ; allure fidèle à tv-app (OverlayBanner).
 */
export function fakeScreenTv(message: FakeScreenMessage): string {
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; font-family: Roboto, system-ui, sans-serif; }
  .programme { position: absolute; inset: 0; background:
    radial-gradient(circle at 78% 30%, #ffe9a8 0 40px, transparent 42px),
    radial-gradient(ellipse 900px 260px at 20% 100%, #2f6b45 0 99%, transparent 100%),
    radial-gradient(ellipse 1000px 300px at 90% 105%, #3f8a55 0 99%, transparent 100%),
    linear-gradient(#5aa5d8, #b9dcef 70%, #e8f1d8); }
  .chaine { position: absolute; top: 28px; left: 36px; padding: 6px 14px; border-radius: 6px; background: rgba(0,0,0,.45); color: #fff; font-size: 20px; }
  .bandeau { position: absolute; top: 28px; right: 32px; display: flex; align-items: center; gap: 18px; padding: 18px 28px 18px 20px;
    border-radius: 20px; background: rgba(24,27,34,.94); color: #e8eaed; box-shadow: 0 8px 30px rgba(0,0,0,.45); }
  .icone { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: #5b8def; }
  .titre { font-size: 30px; font-weight: 600; }
  .sous-titre { font-size: 20px; color: #9aa1ab; margin-top: 2px; }
  .niveau { display: flex; align-items: center; gap: 5px; height: 36px; margin-left: 6px; }
  .niveau span { width: 6px; border-radius: 3px; background: #5b8def; }
</style>
<div class="programme"></div>
<div class="chaine">Documentaire · Les collines</div>
<div class="bandeau">
  <div class="icone"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0f1115" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></div>
  <div><div class="titre">${escape(message.title)}</div><div class="sous-titre">Le son du programme est baissé</div></div>
  <div class="niveau">${[14, 26, 34, 22, 30].map((h) => `<span style="height:${h}px"></span>`).join('')}</div>
</div>`;
}

/**
 * Maquette d'écran de télé (1280×720) pendant un message écrit : le programme continue, le bandeau de l'appli en haut
 * au centre (icône bulle, « Message d'Alex », le texte en gros), couleurs du thème sombre de HomeHub ; allure fidèle à
 * tv-app (OverlayBanner.showMessage).
 */
export function fakeScreenTvText(message: FakeScreenText): string {
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; font-family: Roboto, system-ui, sans-serif; }
  .programme { position: absolute; inset: 0; background:
    radial-gradient(circle at 78% 30%, #ffe9a8 0 40px, transparent 42px),
    radial-gradient(ellipse 900px 260px at 20% 100%, #2f6b45 0 99%, transparent 100%),
    radial-gradient(ellipse 1000px 300px at 90% 105%, #3f8a55 0 99%, transparent 100%),
    linear-gradient(#5aa5d8, #b9dcef 70%, #e8f1d8); }
  .chaine { position: absolute; top: 28px; left: 36px; padding: 6px 14px; border-radius: 6px; background: rgba(0,0,0,.45); color: #fff; font-size: 20px; }
  .bandeau { position: absolute; top: 72px; left: 50%; transform: translateX(-50%); width: max-content; max-width: 900px; display: flex; align-items: flex-start; gap: 24px;
    padding: 24px 40px 28px 26px; border-radius: 24px; background: rgba(24,27,34,.94); color: #e8eaed; box-shadow: 0 8px 30px rgba(0,0,0,.45); }
  .icone { flex: none; display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; background: #5b8def; }
  .titre { font-size: 24px; color: #9aa1ab; font-weight: 600; }
  .texte { font-size: 44px; line-height: 1.25; font-weight: 600; margin-top: 6px; }
</style>
<div class="programme"></div>
<div class="chaine">Documentaire · Les collines</div>
<div class="bandeau">
  <div class="icone"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#0f1115" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg></div>
  <div><div class="titre">${escape(message.title)}</div><div class="texte">${escape(message.text)}</div></div>
</div>`;
}

/**
 * Maquette d'écran de télé pour l'alerte d'un minuteur : le programme continue, le bandeau de l'appli en haut à droite
 * (icône minuteur sur fond soleil, nom du minuteur, « C'est l'heure ! », aide des touches) et le bouton « Arrêter »
 * qui a le focus de la télécommande ; allure fidèle à tv-app (MinuteurAlertes).
 */
export function fakeScreenTimerTv(alert: FakeScreenTimer): string {
  return fakeScreenTv({ title: '', bytes: 0 }).replace(
    /<div class="bandeau">[\s\S]*$/u,
    `<style>
  .icone.soleil { background: #f2b84b; }
  .aide { font-size: 16px; color: #9aa1ab; margin-top: 4px; }
  .arreter { margin-left: 14px; padding: 12px 30px; border-radius: 999px; background: #f2b84b; color: #0f1115; font-size: 24px; font-weight: 700;
    outline: 4px solid #e8eaed; outline-offset: 0; }
</style>
<div class="bandeau">
  <div class="icone soleil"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0f1115" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/></svg></div>
  <div><div class="titre">${escape(alert.title)}</div><div class="sous-titre">${escape(alert.subtitle)}</div><div class="aide">OK : arrêter partout · Retour : masquer</div></div>
  <div class="arreter">Arrêter</div>
</div>`,
  );
}
