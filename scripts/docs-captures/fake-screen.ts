// Fausse appli HomeHub TV du monde fictif : elle fait ce que fait l'appli sur la télé (tv-app/), avec le jeton de la
// télé fictive écrit dans screens.json par docs-captures.ts : attente longue des événements, téléchargement du message
// vocal, compte rendu « lecture commencée ». Le dernier message reçu va dans fake-screen.json (dossier d'état) ; les
// captures en font une maquette d'écran de télé : un programme inventé, et le bandeau de l'appli par-dessus.
// Télécommande : elle envoie son état (écran allumé, appli au premier plan, injecteur prêt) et ses applis inventées
// (fake-banners.ts), reçoit touches, texte, lancement et marche/arrêt, en tient compte (appli lancée, veille) et le
// note dans fake-screen-remote.json. Message écrit : gardé dans fake-screen-text.json, compte rendu « affiché » ; les
// captures en font la maquette du bandeau de l'appli.
// Minuteur terminé (fonction 3) : l'alerte reçue va dans fake-screen-timer.json (retirée quand le minuteur est
// arrêté), pour la maquette du bandeau « Arrêter ». Minuteurs en cours : la dernière liste reçue va dans
// fake-screen-timers.json, pour la maquette du petit décompte en bas à droite. Alerte du bus du matin (fonction 4) :
// le dernier bandeau reçu va dans fake-screen-bus.json (maquette : fake-screen-bus.ts). Alerte pluie
// du matin (fonction 14) : le bandeau reçu va dans fake-screen-rain.json (maquette : fake-screen-rain.ts).
// Rappels (fonction 5 : routine du soir, mots à lire) : le dernier va dans fake-screen-reminder.json
// (maquette : fake-screen-reminder.ts).
// Pause et reprise (fonction 6) : elle retient si le programme est en pause et le
// dernier bandeau (« À table ! »), pour la maquette de fake-screen-pause.ts ; son volume est réglable.
// Allumée, en veille ou absente (fonction 7) : fake-screen-mode.json (dossier d'état) le dit, relu à chaque tour. En
// veille, l'écran est annoncé éteint et un message vocal est refusé comme le fait l'appli (« écran éteint ») ; absente,
// elle ne demande plus rien (HomeHub la voit partie au bout de GONE_MS).
// Photo partagée (fonction 11) : téléchargée et notée dans fake-screen-media.json.
// Séance de sport (fonction 12) : elle note l'ouverture et la fermeture de la page (la page elle-même est capturée
// à part, avec le jeton de cette télé).
// Mode cuisine d'une recette (fonction 13) : ouverture acceptée (vue lue par fake-screen-cook.ts).
// Réponses rapides (fonction 10) : elle retient l'identifiant de réponse du dernier message écrit ou vocal ; quand
// fake-screen-reply.json apparaît ({ "reply": "coming" }), elle répond comme si on avait choisi à la télécommande,
// puis efface le fichier.
// Heure du coucher (fonction 16) : rappel et changements comme les autres rappels, pause comme « À table ! », écran de
// veille du coucher ouvert ou fermé (noté dans fake-screen-remote.json, `bedtime`).
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUICK_REPLIES, QUICK_REPLY_LABELS, type QuickReply, SCREEN_OFF_REASON, SCREEN_PROTOCOL, SCREEN_PROTOCOL_HEADER, type ScreenEvent, type ScreenEvents, type ScreenRunningTimer, type ScreenStateReport } from '../../shared/screen.ts';
import { fakeScreenApps } from './fake-banners.ts';
import { FAKE_SCREEN_RAIN_FILE } from './fake-screen-rain.ts';
import { FAKE_SCREEN_REMINDER_FILE } from './fake-screen-reminder.ts';
import type { ScreenMediaEvent } from '../../shared/screen-media.ts';
import { FAKE_SCREEN_MEDIA_FILE, type FakeScreenMedia } from './fake-photo.ts';
import { fakeTalk } from './fake-screen-talk.ts';

export const FAKE_SCREEN_TOKEN = 'docs-tele';
export const FAKE_SCREEN_ID = 'docs-tele';
export const FAKE_SCREEN_FILE = 'fake-screen.json';
export const FAKE_SCREEN_REMOTE_FILE = 'fake-screen-remote.json';
export const FAKE_SCREEN_TEXT_FILE = 'fake-screen-text.json';
export const FAKE_SCREEN_TIMER_FILE = 'fake-screen-timer.json';
export const FAKE_SCREEN_TIMERS_FILE = 'fake-screen-timers.json';
export const FAKE_SCREEN_BUS_FILE = 'fake-screen-bus.json';
export const FAKE_SCREEN_MODE_FILE = 'fake-screen-mode.json';
export const FAKE_SCREEN_REPLY_FILE = 'fake-screen-reply.json';

/** Réponse demandée dans fake-screen-reply.json ({ "reply": "coming" }) ; absente ou illisible : null. */
export function readFakeScreenReply(dir: string): QuickReply | null {
  const path = join(dir, FAKE_SCREEN_REPLY_FILE);
  if (!existsSync(path)) return null;
  try {
    const { reply } = JSON.parse(readFileSync(path, 'utf8')) as { reply?: string };
    return (QUICK_REPLIES as readonly string[]).includes(reply ?? '') ? (reply as QuickReply) : null;
  } catch {
    return null;
  }
}

/** Allumée (par défaut), en veille (écran éteint, appli joignable) ou absente (appli muette). */
export type FakeScreenMode = 'allumee' | 'veille' | 'absente';

/** Mode écrit dans fake-screen-mode.json ({ "mode": "veille" }) ; sans fichier ou illisible : allumée. */
export function readFakeScreenMode(dir: string): FakeScreenMode {
  const path = join(dir, FAKE_SCREEN_MODE_FILE);
  if (!existsSync(path)) return 'allumee';
  try {
    const { mode } = JSON.parse(readFileSync(path, 'utf8')) as { mode?: string };
    return mode === 'veille' || mode === 'absente' ? mode : 'allumee';
  } catch {
    return 'allumee';
  }
}

/** Compte rendu d'un message vocal, comme l'appli (voiceRefusal dans tv-app) : refusé écran éteint, sinon lu ou introuvable. */
export function fakeVoiceReport(screenOn: boolean, clipStatus: number): { ok: true } | { ok: false; reason: string } {
  if (!screenOn) return { ok: false, reason: SCREEN_OFF_REASON };
  return clipStatus >= 200 && clipStatus < 300 ? { ok: true } : { ok: false, reason: `message introuvable (HTTP ${clipStatus})` };
}

/** Ce que la fausse télé a reçu : le titre du bandeau et la taille du message. */
export type FakeScreenMessage = { title: string; bytes: number };
/** Message écrit reçu : titre, texte et durée du bandeau ; `replies` : réponses rapides proposées (fonction 10) ; `discreet` : mode film (fonction 15). */
export type FakeScreenText = { title: string; text: string; seconds: number; replies?: boolean; discreet?: boolean };
/** Alerte de minuteur affichée par la fausse télé : de quoi dessiner le bandeau, et le minuteur à arrêter. */
export type FakeScreenTimer = { timerId: string; title: string; subtitle: string };
/** Minuteurs en cours reçus (événement `timers`) : l'heure du serveur à l'envoi et la liste. */
export type FakeScreenTimers = { serverNow: string; timers: ScreenRunningTimer[] };
/** Ordres de la télécommande reçus, en clair (« touches : bas bas ok »), et l'état qui en résulte. */
export type FakeScreenRemote = { received: string[]; screenOn: boolean; foreground: string; paused?: boolean; notice?: { title: string; subtitle: string }; bedtime?: boolean };

/** Ce que fait la fausse télé d'un ordre de la télécommande : la ligne du journal, et l'état qui change. */
export function applyRemote(event: ScreenEvent, state: ScreenStateReport, remote?: FakeScreenRemote): string | null {
  switch (event.kind) {
    case 'key':
      if (remote) {
        for (const key of event.keys) {
          if (key === 'pause') remote.paused = true;
          if (key === 'play') remote.paused = false;
          if (key === 'playpause') remote.paused = !remote.paused;
        }
        if (event.notice) remote.notice = event.notice;
      }
      return `touches : ${event.keys.join(' ')}${event.notice ? ` (bandeau « ${event.notice.title} »)` : ''}`;
    case 'text':
      return `texte : ${event.text}${event.submit ? ' ⏎' : ''}`;
    case 'launch':
      state.foreground = event.package;
      return `appli : ${event.package}`;
    case 'power':
      state.screenOn = event.on;
      return event.on ? 'allumer' : 'veille';
    case 'workout':
      return event.action === 'start' ? `séance de sport : page ${event.page} ouverte` : `séance de sport : fin (bandeau « ${event.notice?.title} »)`;
    case 'cook':
      return 'mode cuisine ouvert';
    case 'bedtime':
      if (remote) remote.bedtime = event.action === 'sleep';
      return event.action === 'sleep' ? 'coucher : écran de veille ouvert' : 'coucher : écran de veille fermé';
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
  const state: ScreenStateReport = { screenOn: true, foreground: 'fr.exemple.video', control: 'adb', addresses: ['127.0.0.1'], volume: 'adjustable' };
  const remote: FakeScreenRemote = { received: [], screenOn: true, foreground: state.foreground! };
  let after: number | null = null;
  let introduced = false;
  let mode: FakeScreenMode = 'allumee';
  /** Identifiant de réponse du dernier message écrit ou vocal reçu (fonction 10). */
  let replyId: string | null = null;
  // Réponse « choisie à la télécommande » : fake-screen-reply.json, vu en 0,3 s, envoyé puis effacé.
  setInterval(() => {
    const reply = readFakeScreenReply(dir);
    if (!reply) return;
    rmSync(join(dir, FAKE_SCREEN_REPLY_FILE), { force: true });
    if (!replyId) return console.warn('Fausse appli HomeHub TV : aucun message auquel répondre');
    void post('POST', `/api/screen/replies/${replyId}`, { reply }).then(
      (res) => console.log(`Fausse appli HomeHub TV, réponse « ${reply} » : HTTP ${res.status}`),
      () => {},
    );
  }, 300);
  // Changement de mode, vu en 0,3 s : l'écran s'allume ou s'éteint et l'appli le dit aussitôt à HomeHub (comme
  // ACTION_SCREEN_ON/OFF), même pendant une attente longue ; absente, la boucle cesse de demander.
  setInterval(() => {
    const wanted = readFakeScreenMode(dir);
    if (wanted === mode) return;
    mode = wanted;
    if (mode === 'absente') return;
    state.screenOn = mode === 'allumee';
    remote.screenOn = state.screenOn;
    if (introduced) void post('POST', '/api/screen/state', state).catch(() => {});
  }, 300);

  /** Photo ou vidéo partagée (fonction 11) : téléchargée, gardée dans le dossier d'état, « affichée ». */
  const receiveMedia = async (event: ScreenMediaEvent) => {
    const res = await fetch(`${base}${event.url}`, { headers });
    const data = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    if (data) {
      const file = join(dir, `fake-screen-media.${event.url.split('.').pop()}`);
      writeFileSync(file, data);
      const media: FakeScreenMedia = { title: event.title, media: event.media, file, contentType: event.contentType, bytes: data.byteLength };
      writeFileSync(join(dir, FAKE_SCREEN_MEDIA_FILE), JSON.stringify(media));
      console.log(`Fausse appli HomeHub TV : ${event.title}, ${data.byteLength} octets`);
    }
    await post('POST', `/api/screen/events/${event.id}/report`, data ? { ok: true } : { ok: false, reason: `fichier introuvable (HTTP ${res.status})` });
  };
  const loop = async (): Promise<void> => {
    try {
      if (mode === 'absente') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return loop();
      }
      if (!introduced) {
        // Comme l'appli à son démarrage : son état, puis la liste des applis du lanceur.
        introduced = (await post('POST', '/api/screen/state', state)).ok && (await post('PUT', '/api/screen/apps', { apps: fakeScreenApps() })).ok;
      }
      const res = await fetch(`${base}/api/screen/events${after === null ? '' : `?after=${after}`}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { events, last } = (await res.json()) as ScreenEvents;
      after = last;
      for (const event of events) {
        // Parler en direct : écouté à part (fake-screen-talk.ts), sans retenir les autres événements.
        if (event.kind === 'talk') {
          void fakeTalk(base, headers, event);
          continue;
        }
        if (event.kind === 'media') {
          await receiveMedia(event);
          continue;
        }
        if (event.kind === 'reminder') {
          writeFileSync(join(dir, FAKE_SCREEN_REMINDER_FILE), JSON.stringify({ title: event.title, subtitle: event.subtitle, reminder: event.reminder }));
          console.log(`Fausse appli HomeHub TV, rappel : ${event.title} (${event.subtitle})`);
          await post('POST', `/api/screen/events/${event.id}/report`, { ok: true });
          continue;
        }
        if (event.kind === 'rain') {
          writeFileSync(join(dir, FAKE_SCREEN_RAIN_FILE), JSON.stringify({ title: event.title, subtitle: event.subtitle }));
          console.log(`Fausse appli HomeHub TV, alerte pluie : ${event.title}`);
          await post('POST', `/api/screen/events/${event.id}/report`, { ok: true });
          continue;
        }
        if (event.kind === 'message') {
          replyId = event.replyId ?? null;
          writeFileSync(join(dir, FAKE_SCREEN_TEXT_FILE), JSON.stringify({ title: event.title, text: event.text, seconds: event.seconds, replies: !!event.replyId, ...(event.discreet && { discreet: true }) } satisfies FakeScreenText));
          console.log(`Fausse appli HomeHub TV, message écrit : ${event.title}, « ${event.text} »`);
          await post('POST', `/api/screen/events/${event.id}/report`, { ok: true });
          continue;
        }
        if (event.kind === 'timers') {
          // Comme MinuteurDecompte (tv-app) : la dernière liste fait foi.
          writeFileSync(join(dir, FAKE_SCREEN_TIMERS_FILE), JSON.stringify({ serverNow: event.serverNow, timers: event.timers } satisfies FakeScreenTimers));
          await post('POST', `/api/screen/events/${event.id}/report`, { ok: true });
          console.log(`Fausse appli HomeHub TV, minuteurs en cours : ${event.timers.map((t) => t.label).join(', ') || 'aucun'}`);
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
        if (event.kind === 'bus') {
          writeFileSync(join(dir, FAKE_SCREEN_BUS_FILE), JSON.stringify({ title: event.title, subtitle: event.subtitle }));
          console.log(`Fausse appli HomeHub TV, bus : ${event.title} (${event.subtitle})`);
          await post('POST', `/api/screen/events/${event.id}/report`, { ok: true });
          continue;
        }
        if (event.kind !== 'voice') {
          const line = applyRemote(event, state, remote);
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
        if (!state.screenOn) {
          console.log(`Fausse appli HomeHub TV : ${event.title} refusé, écran éteint`);
          await post('POST', `/api/screen/events/${event.id}/report`, fakeVoiceReport(false, 0));
          continue;
        }
        replyId = event.replyId ?? null;
        const clip = await fetch(`${base}${event.audio}`, { headers });
        const bytes = clip.ok ? (await clip.arrayBuffer()).byteLength : 0;
        writeFileSync(join(dir, FAKE_SCREEN_FILE), JSON.stringify({ title: event.title, bytes } satisfies FakeScreenMessage));
        console.log(`Fausse appli HomeHub TV : ${event.title}, ${bytes} octets`);
        await post('POST', `/api/screen/events/${event.id}/report`, fakeVoiceReport(true, clip.status));
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
 * tv-app (OverlayBanner.showMessage). Avec les réponses rapides (fonction 10) : « OK », « J'arrive », « 5 minutes »
 * dessous, « OK » avec le focus de la télécommande.
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
  .bandeau.reponses { flex-direction: column; gap: 18px; }
  .haut { display: flex; align-items: flex-start; gap: 24px; }
  .choix { display: flex; gap: 14px; padding-left: 4px; }
  .choix span { padding: 10px 26px; border-radius: 999px; background: #181b22; border: 1px solid #9aa1ab; font-size: 24px; font-weight: 700; }
  .choix span.focus { background: #5b8def; border: 4px solid #e8eaed; padding: 7px 23px; }
  .aide { font-size: 17px; color: #9aa1ab; padding-left: 6px; }
</style>
<div class="programme"></div>
<div class="chaine">Documentaire · Les collines</div>
<div class="bandeau${message.replies ? ' reponses' : ''}">
  <div class="haut">
  <div class="icone"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#0f1115" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg></div>
  <div><div class="titre">${escape(message.title)}</div><div class="texte">${escape(message.text)}</div></div>
  </div>
  ${
    // Réponses rapides (fonction 10), comme OverlayBanner : « OK » a le focus de la télécommande.
    message.replies
      ? `<div class="choix">${Object.values(QUICK_REPLY_LABELS).map((label, i) => `<span${i === 0 ? ' class="focus"' : ''}>${escape(label)}</span>`).join('')}</div><div class="aide">◀ ▶ puis OK : répondre · Retour : masquer</div>`
      : ''
  }
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

/** Temps restant comme l'appli (Minuteur.kt, formatRemaining) : arrondi à la seconde supérieure, « 9:05 », « 1:02:03 ». */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Maquette d'écran de télé pendant que des minuteurs tournent : le programme continue, en petit en bas à droite le
 * minuteur le plus proche de la fin (icône sur fond soleil, nom, temps restant) et « +1 » s'il y en a d'autres ; rien
 * n'y a le focus. Allure fidèle à tv-app (MinuteurDecompte), temps restant pris à l'heure du serveur.
 */
export function fakeScreenCountdownTv(running: FakeScreenTimers): string {
  const now = new Date(running.serverNow).getTime();
  const left = running.timers.filter((t) => new Date(t.endsAt).getTime() > now);
  const first = left[0];
  const pill = first
    ? `<style>
  .decompte { position: absolute; right: 28px; bottom: 24px; display: flex; align-items: center; gap: 8px; padding: 6px 14px 6px 8px; border-radius: 999px;
    background: rgba(24,27,34,.94); box-shadow: 0 6px 20px rgba(0,0,0,.4); }
  .decompte .icone { width: 26px; height: 26px; border-radius: 50%; background: #f2b84b; display: grid; place-items: center; }
  .decompte .nom { font-size: 13px; color: #9aa1ab; }
  .decompte .reste { font-size: 16px; font-weight: 700; color: #e8eaed; font-variant-numeric: tabular-nums; }
  .decompte .autres { font-size: 13px; font-weight: 700; color: #f2b84b; }
</style>
<div class="decompte">
  <div class="icone"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0f1115" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/></svg></div>
  <div class="nom">${escape(first.label)}</div>
  <div class="reste">${formatRemaining(new Date(first.endsAt).getTime() - now)}</div>
  ${left.length > 1 ? `<div class="autres">+${left.length - 1}</div>` : ''}
</div>`
    : '';
  return fakeScreenTv({ title: '', bytes: 0 }).replace(/<div class="bandeau">[\s\S]*$/u, pill);
}
