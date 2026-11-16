// Rappel reçu par la fausse appli HomeHub TV (fake-screen.ts) et maquette de l'écran de la télé qui le montre : le
// programme continue, le bandeau cloche de l'appli en haut à droite (titre et sous-titre), comme tv-app (OverlayBanner,
// avis sans barres de niveau ; lune pour l'heure du coucher). Couleurs du thème sombre de HomeHub, recopiées comme dans la maquette du message vocal.

export const FAKE_SCREEN_REMINDER_FILE = 'fake-screen-reminder.json';

/** Le dernier rappel affiché par la fausse télé. */
export type FakeScreenReminder = { title: string; subtitle: string; reminder?: string };

const BELL = '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>';
const MOON = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';

const escape = (s: string) => s.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);

/** Maquette d'écran de télé (1280×720) avec le bandeau du rappel. */
export function fakeScreenReminderTv(reminder: FakeScreenReminder): string {
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; font-family: Roboto, system-ui, sans-serif; }
  .programme { position: absolute; inset: 0; background:
    radial-gradient(circle at 22% 26%, #f6d78b 0 46px, transparent 48px),
    radial-gradient(ellipse 1100px 280px at 70% 102%, #23465e 0 99%, transparent 100%),
    radial-gradient(ellipse 800px 240px at 10% 106%, #2d5873 0 99%, transparent 100%),
    linear-gradient(#e58a5c, #f2b77a 55%, #f7d9a4); }
  .chaine { position: absolute; top: 28px; left: 36px; padding: 6px 14px; border-radius: 6px; background: rgba(0,0,0,.45); color: #fff; font-size: 20px; }
  .bandeau { position: absolute; top: 28px; right: 32px; display: flex; align-items: center; gap: 18px; padding: 18px 28px 18px 20px; max-width: 760px;
    border-radius: 20px; background: rgba(24,27,34,.94); color: #e8eaed; box-shadow: 0 8px 30px rgba(0,0,0,.45); }
  .icone { flex-shrink: 0; display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: #5b8def; }
  .titre { font-size: 30px; font-weight: 600; }
  .sous-titre { font-size: 20px; color: #9aa1ab; margin-top: 2px; }
</style>
<div class="programme"></div>
<div class="chaine">Dessin animé · Le phare</div>
<div class="bandeau">
  <div class="icone"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0f1115" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${reminder.reminder === 'bedtime' ? MOON : BELL}</svg></div>
  <div><div class="titre">${escape(reminder.title)}</div><div class="sous-titre">${escape(reminder.subtitle)}</div></div>
</div>`;
}
