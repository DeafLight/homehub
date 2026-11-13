// Fausse appli HomeHub TV du monde fictif : elle fait ce que fait l'appli sur la télé (tv-app/), avec le jeton de la
// télé fictive écrit dans screens.json par docs-captures.ts : attente longue des événements, téléchargement du message
// vocal, compte rendu « lecture commencée ». Le dernier message reçu va dans fake-screen.json (dossier d'état) ; les
// captures en font une maquette d'écran de télé : un programme inventé, et le bandeau de l'appli par-dessus.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCREEN_PROTOCOL, SCREEN_PROTOCOL_HEADER, type ScreenEvents } from '../../shared/screen.ts';

export const FAKE_SCREEN_TOKEN = 'docs-tele';
export const FAKE_SCREEN_ID = 'docs-tele';
export const FAKE_SCREEN_FILE = 'fake-screen.json';

/** Ce que la fausse télé a reçu : le titre du bandeau et la taille du message. */
export type FakeScreenMessage = { title: string; bytes: number };

/** Démarre la fausse appli contre le serveur `base` (http://127.0.0.1:port) ; elle tourne jusqu'à la fin du processus. */
export function startFakeScreen(base: string) {
  const headers = { Authorization: `Bearer ${FAKE_SCREEN_TOKEN}`, [SCREEN_PROTOCOL_HEADER]: String(SCREEN_PROTOCOL) };
  let after: number | null = null;
  const loop = async (): Promise<void> => {
    try {
      const res = await fetch(`${base}/api/screen/events${after === null ? '' : `?after=${after}`}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { events, last } = (await res.json()) as ScreenEvents;
      after = last;
      for (const event of events) {
        const clip = await fetch(`${base}${event.audio}`, { headers });
        const bytes = clip.ok ? (await clip.arrayBuffer()).byteLength : 0;
        writeFileSync(join(process.env.HOMEHUB_STATE_DIR ?? '.', FAKE_SCREEN_FILE), JSON.stringify({ title: event.title, bytes } satisfies FakeScreenMessage));
        console.log(`Fausse appli HomeHub TV : ${event.title}, ${bytes} octets`);
        await fetch(`${base}/api/screen/events/${event.id}/report`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(clip.ok ? { ok: true } : { ok: false, reason: `message introuvable (HTTP ${clip.status})` }),
        });
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
  .bandeau { position: absolute; top: 32px; right: 40px; display: flex; align-items: center; gap: 18px; padding: 18px 28px 18px 20px;
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
  <div class="niveau">${[14, 26, 36, 22, 30, 16].map((h) => `<span style="height:${h}px"></span>`).join('')}</div>
</div>`;
}
