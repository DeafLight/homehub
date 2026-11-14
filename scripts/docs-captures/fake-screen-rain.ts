// Alerte pluie reçue par la fausse appli HomeHub TV (fake-screen.ts) : le bandeau est gardé dans fake-screen-rain.json
// (dossier d'état), et les captures en font une maquette d'écran de télé, le programme du matin avec le bandeau
// parapluie de l'appli en haut à droite ; allure fidèle à tv-app (OverlayBanner, icône ic_umbrella).

export const FAKE_SCREEN_RAIN_FILE = 'fake-screen-rain.json';

/** Bandeau reçu : « Pluie vers 8 h » / « Prenez un parapluie ». */
export type FakeScreenRain = { title: string; subtitle: string };

const escape = (s: string) => s.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);

/** Maquette d'écran de télé (1280×720) : dessin animé du matin inventé, bandeau de l'alerte pluie par-dessus. */
export function fakeScreenRainTv(rain: FakeScreenRain): string {
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; font-family: Roboto, system-ui, sans-serif; }
  .programme { position: absolute; inset: 0; background:
    radial-gradient(circle at 22% 26%, #fff6c9 0 54px, transparent 56px),
    radial-gradient(ellipse 140px 70px at 60% 24%, #ffffff 0 99%, transparent 100%),
    radial-gradient(ellipse 110px 54px at 66% 20%, #ffffff 0 99%, transparent 100%),
    radial-gradient(ellipse 820px 240px at 30% 104%, #e58a3a 0 99%, transparent 100%),
    radial-gradient(ellipse 900px 280px at 85% 108%, #c8613a 0 99%, transparent 100%),
    linear-gradient(#ffb56b, #ffd9a0 60%, #ffe9c4); }
  .chaine { position: absolute; top: 28px; left: 36px; padding: 6px 14px; border-radius: 6px; background: rgba(0,0,0,.45); color: #fff; font-size: 20px; }
  .bandeau { position: absolute; top: 28px; right: 32px; display: flex; align-items: center; gap: 18px; padding: 18px 28px 18px 20px;
    border-radius: 20px; background: rgba(24,27,34,.94); color: #e8eaed; box-shadow: 0 8px 30px rgba(0,0,0,.45); }
  .icone { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: #5b8def; }
  .titre { font-size: 30px; font-weight: 600; }
  .sous-titre { font-size: 20px; color: #9aa1ab; margin-top: 2px; }
</style>
<div class="programme"></div>
<div class="chaine">Dessin animé · Le renard du matin</div>
<div class="bandeau">
  <div class="icone"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0f1115" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12a10.06 10.06 0 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/></svg></div>
  <div><div class="titre">${escape(rain.title)}</div><div class="sous-titre">${escape(rain.subtitle)}</div></div>
</div>`;
}
