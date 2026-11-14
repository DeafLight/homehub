// Maquette d'écran de télé pour l'alerte du bus du matin (fonction 4 de l'appli HomeHub TV) : le programme du matin
// continue, le bandeau de l'appli en haut à droite (icône bus, « Bus dans 11 min », qui et quand partir). Allure fidèle
// à tv-app (OverlayBanner, icône ic_bus) ; même programme inventé que la maquette du message vocal (fake-screen.ts).

/** Ce que la fausse télé a reçu : le dernier bandeau du bus. */
export type FakeScreenBus = { title: string; subtitle: string };

const escape = (s: string) => s.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);

export function fakeScreenBusTv(bus: FakeScreenBus): string {
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
</style>
<div class="programme"></div>
<div class="chaine">Dessins animés du matin</div>
<div class="bandeau">
  <div class="icone"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0f1115" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6M15 6v6M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3M9 18h5"/><circle cx="7" cy="18" r="2"/><circle cx="16" cy="18" r="2"/></svg></div>
  <div><div class="titre">${escape(bus.title)}</div><div class="sous-titre">${escape(bus.subtitle)}</div></div>
</div>`;
}
