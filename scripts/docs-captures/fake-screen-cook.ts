// Maquette de la vue cuisine de l'appli HomeHub TV (fonction 13) pour les captures du monde fictif : la vue que la
// fausse télé lit à HomeHub (GET /api/screen/cook, avec le jeton de la télé fictive), dessinée comme CuisineActivity
// (tv-app) : en-tête, étape en grand, mode Cookeo, boutons des durées, minuteurs de la maison, étape suivante.
import { SCREEN_PROTOCOL, SCREEN_PROTOCOL_HEADER } from '../../shared/screen.ts';
import type { ScreenCook } from '../../shared/screen-cook.ts';
import { FAKE_SCREEN_TOKEN } from './fake-screen.ts';

/** La vue cuisine de la télé fictive, telle que l'appli la lit. */
export async function fakeScreenCookView(base: string): Promise<ScreenCook | null> {
  const res = await fetch(`${base}/api/screen/cook`, { headers: { Authorization: `Bearer ${FAKE_SCREEN_TOKEN}`, [SCREEN_PROTOCOL_HEADER]: String(SCREEN_PROTOCOL) } });
  if (!res.ok) throw new Error(`vue cuisine de la fausse télé : HTTP ${res.status}`);
  return ((await res.json()) as { cook: ScreenCook | null }).cook;
}

const escape = (s: string) => s.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);
const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
/** Taille du texte de l'étape comme stepTextSize (Cuisine.kt) ; la maquette compte 1 px par dp, comme le reste. */
const stepSize = (length: number) => (length <= 80 ? 46 : length <= 160 ? 40 : length <= 260 ? 34 : length <= 400 ? 28 : 24);

/** Maquette d'écran de télé (1280×720) de la vue cuisine, couleurs du thème sombre de HomeHub. */
export function fakeScreenCook(cook: ScreenCook): string {
  const step = cook.step;
  const where = [cook.title, step?.section].filter(Boolean).join(' · ');
  const remaining = new Map(cook.timers.map((t) => [t.id, t.remainingSeconds]));
  const buttons = (step?.durations ?? [])
    .map((d, i) => {
      const running = d.timerId !== null;
      const text = running ? `Minuteur · ${clock(remaining.get(d.timerId!) ?? d.seconds)}` : `Lancer ${d.text}`;
      return `<div class="bouton ${running ? '' : 'primaire'} ${i === 0 ? 'focus' : ''}">${escape(text)}</div>`;
    })
    .join('');
  const timers = cook.timers
    .map((t) =>
      t.ended
        ? `<div class="minuteur"><div class="nom">${escape(t.label)}</div><div class="bouton sonne">Sonne ! Arrêter</div></div>`
        : `<div class="minuteur"><div class="nom ${t.step === null ? 'autre' : ''}">${escape(t.label)}</div><div class="reste">${clock(t.remainingSeconds)}</div></div>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #0f1115; color: #e8eaed; font-family: Roboto, system-ui, sans-serif; }
  .ecran { box-sizing: border-box; display: flex; flex-direction: column; height: 100%; padding: 32px 48px 26px; }
  .tete { display: flex; align-items: center; gap: 24px; font-size: 24px; }
  .ou { flex: 1; color: #9aa1ab; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .numero { font-weight: 700; font-size: 26px; }
  .corps { flex: 1; display: flex; gap: 20px; margin: 20px 0 16px; min-height: 0; }
  .carte { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 18px; padding: 28px 36px; border-radius: 28px; background: #181b22; }
  .etape { margin: 0; font-weight: 700; line-height: 1.25; white-space: pre-line; }
  .puce { padding: 8px 20px; border-radius: 999px; background: #3d3018; color: #f2b84b; font-size: 24px; font-weight: 700; }
  .bouton { padding: 14px 28px; border-radius: 18px; background: #262a33; font-size: 26px; font-weight: 700; border: 4px solid transparent; }
  .bouton.primaire { background: #5b8def; color: #0f1115; }
  .bouton.sonne { background: #f2b84b; color: #0f1115; margin-top: 6px; display: inline-block; }
  .bouton.focus { border-color: #e8eaed; }
  .cote { width: 300px; align-self: flex-start; box-sizing: border-box; padding: 20px 22px; border-radius: 24px; background: #181b22; }
  .titre { color: #9aa1ab; font-size: 20px; }
  .minuteur { margin-top: 12px; }
  .nom { font-size: 20px; }
  .nom.autre { color: #9aa1ab; }
  .reste { font-size: 34px; font-weight: 700; color: #5b8def; }
  .pied { display: flex; gap: 24px; align-items: center; color: #9aa1ab; font-size: 22px; }
  .suite { flex: 1; }
  .touches { font-size: 20px; }
</style>
<div class="ecran">
  <div class="tete"><div class="ou">${escape(where)}</div><div class="numero">${cook.total ? `Étape ${cook.index + 1} / ${cook.total}` : ''}</div></div>
  <div class="corps">
    <div class="carte">
      ${step ? `<p class="etape" style="font-size:${stepSize(step.text.length)}px">${escape(step.text)}</p>` : '<p class="etape">Cette recette n’a pas encore d’étapes.</p>'}
      ${step?.mode ? `<div class="puce">Cookeo · ${escape(step.mode)}</div>` : ''}
      ${buttons}
    </div>
    ${cook.timers.length ? `<div class="cote"><div class="titre">Minuteurs</div>${timers}</div>` : ''}
  </div>
  <div class="pied"><div class="suite">${cook.next ? `Ensuite : ${escape(cook.next)}` : 'Dernière étape'}</div><div class="touches">◀ ▶ étapes · OK minuteur · Retour quitter</div></div>
</div>`;
}
