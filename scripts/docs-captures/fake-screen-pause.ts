// Maquette d'écran de télé après « À table ! » (fonction 6), pour les captures : le programme inventé de fake-screen.ts
// mis en pause (image assombrie, symbole pause au centre) et le bandeau de l'appli (cloche, titre, « De la part
// d'Alex »), allure fidèle à tv-app (OverlayBanner, bandeau sans niveau sonore). Couleurs du thème sombre de HomeHub.
import type { FakeScreenRemote } from './fake-screen.ts';

const escape = (s: string) => s.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);

export function fakeScreenPaused(remote: Pick<FakeScreenRemote, 'paused' | 'notice'>): string {
  const notice = remote.notice ?? { title: 'À table !', subtitle: 'HomeHub' };
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; font-family: Roboto, system-ui, sans-serif; }
  .programme { position: absolute; inset: 0; background:
    radial-gradient(circle at 78% 30%, #ffe9a8 0 40px, transparent 42px),
    radial-gradient(ellipse 900px 260px at 20% 100%, #2f6b45 0 99%, transparent 100%),
    radial-gradient(ellipse 1000px 300px at 90% 105%, #3f8a55 0 99%, transparent 100%),
    linear-gradient(#5aa5d8, #b9dcef 70%, #e8f1d8); }
  .voile { position: absolute; inset: 0; background: rgba(0,0,0,${remote.paused === false ? 0 : 0.35}); }
  .pause { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: ${remote.paused === false ? 'none' : 'flex'}; gap: 22px; }
  .pause span { width: 34px; height: 120px; border-radius: 8px; background: rgba(255,255,255,.9); }
  .chaine { position: absolute; top: 28px; left: 36px; padding: 6px 14px; border-radius: 6px; background: rgba(0,0,0,.45); color: #fff; font-size: 20px; }
  .barre { position: absolute; left: 36px; right: 36px; bottom: 34px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.35); }
  .barre i { display: block; width: 38%; height: 100%; border-radius: 3px; background: #fff; }
  .bandeau { position: absolute; top: 28px; right: 32px; display: flex; align-items: center; gap: 18px; padding: 18px 28px 18px 20px;
    border-radius: 20px; background: rgba(24,27,34,.94); color: #e8eaed; box-shadow: 0 8px 30px rgba(0,0,0,.45); }
  .icone { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: #f2b84b; }
  .titre { font-size: 30px; font-weight: 600; }
  .sous-titre { font-size: 20px; color: #9aa1ab; margin-top: 2px; }
</style>
<div class="programme"></div>
<div class="voile"></div>
<div class="chaine">Documentaire · Les collines</div>
<div class="pause"><span></span><span></span></div>
<div class="barre"><i></i></div>
<div class="bandeau">
  <div class="icone"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0f1115" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>
  <div><div class="titre">${escape(notice.title)}</div><div class="sous-titre">${escape(notice.subtitle)}</div></div>
</div>`;
}
