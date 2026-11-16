// Mode film vu de la télé (fonction 15), pour les captures : maquette d'écran (1280×720) d'un film inventé, avec le
// petit bandeau discret que la fausse appli HomeHub TV (fake-screen.ts) a reçu pendant le film : en bas à gauche, à demi
// transparent, texte réduit ; allure fidèle à tv-app (OverlayBanner.showDiscreet).
import type { FakeScreenText } from './fake-screen.ts';

const escape = (s: string) => s.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);

/** Le film continue en grand ; le message écrit reçu `discreet` tient dans un coin. */
export function fakeScreenFilmTv(message: FakeScreenText): string {
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; font-family: Roboto, system-ui, sans-serif; background: #000; }
  .film { position: absolute; inset: 0; background:
    radial-gradient(circle at 74% 22%, #f4f1d9 0 34px, transparent 36px),
    radial-gradient(ellipse 760px 220px at 25% 100%, #0f1d2e 0 99%, transparent 100%),
    radial-gradient(ellipse 880px 260px at 88% 104%, #16283d 0 99%, transparent 100%),
    linear-gradient(#0b1424, #1b2f4c 60%, #2a3f5c); }
  .bande { position: absolute; left: 0; right: 0; height: 88px; background: #000; }
  .haut { top: 0; } .bas { bottom: 0; }
  .sous-titre-film { position: absolute; bottom: 120px; width: 100%; text-align: center; color: #fff; font-size: 30px; text-shadow: 0 2px 4px #000; }
  .bandeau { position: absolute; left: 36px; bottom: 36px; display: flex; align-items: center; gap: 14px; max-width: 430px;
    padding: 12px 20px 12px 14px; border-radius: 16px; background: rgba(24,27,34,.94); color: #e8eaed; opacity: .85; }
  .icone { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: #5b8def; }
  .titre { font-size: 20px; font-weight: 600; }
  .texte { font-size: 17px; color: #9aa1ab; margin-top: 2px; }
</style>
<div class="film"></div>
<div class="bande haut"></div><div class="bande bas"></div>
<div class="sous-titre-film">— Tu entends ? Le vent s’est levé sur la baie.</div>
<div class="bandeau">
  <div class="icone"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0f1115" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg></div>
  <div><div class="titre">${escape(message.title)}</div><div class="texte">${escape(message.text)}</div></div>
</div>`;
}
