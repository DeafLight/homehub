// Fausse télé du monde fictif : elle répond à l'adresse de la télé de la configuration fictive (tele.exemple.test),
// comme l'appli « Notifications for Android TV » (POST multipart sur le port 7676), et garde le dernier message reçu
// dans fake-tv.json (dossier d'état). Les captures en font une maquette d'écran de télé : une image de programme
// inventée, et le message au centre, en gros, comme l'appli devrait l'afficher (allure à confirmer sur la vraie télé).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TV_HOST = 'tele.exemple.test';
export const FAKE_TV_FILE = 'fake-tv.json';

/** Message reçu par la fausse télé, champs tels que les envoie HomeHub. */
export type FakeTvMessage = Record<string, string>;

/** Reçoit une requête destinée à la télé : garde ses champs texte, répond comme l'appli (200). */
export async function fakeTv(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  if (request.method !== 'POST') return new Response('OK');
  const form = await request.formData();
  const fields: FakeTvMessage = {};
  for (const [key, value] of form.entries()) if (typeof value === 'string') fields[key] = value;
  writeFileSync(join(process.env.HOMEHUB_STATE_DIR ?? '.', FAKE_TV_FILE), JSON.stringify(fields, null, 2));
  return new Response('OK');
}

const escape = (s: string) => s.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);

/** Maquette d'écran de télé (1280×720) : un paysage de programme inventé et le message reçu au centre. */
export function fakeTvScreen(message: FakeTvMessage): string {
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; font-family: Roboto, system-ui, sans-serif; }
  .programme { position: absolute; inset: 0; background:
    radial-gradient(circle at 78% 30%, #ffe9a8 0 40px, transparent 42px),
    radial-gradient(ellipse 900px 260px at 20% 100%, #2f6b45 0 99%, transparent 100%),
    radial-gradient(ellipse 1000px 300px at 90% 105%, #3f8a55 0 99%, transparent 100%),
    linear-gradient(#5aa5d8, #b9dcef 70%, #e8f1d8); }
  .chaine { position: absolute; top: 28px; left: 36px; padding: 6px 14px; border-radius: 6px; background: rgba(0,0,0,.45); color: #fff; font-size: 20px; }
  .popup { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: 900px; padding: 28px 44px;
    border-radius: 8px; background: #000; color: #fff; text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
  .titre { font-size: 30px; opacity: .8; margin-bottom: 12px; }
  .message { font-size: 54px; line-height: 1.2; font-weight: 500; }
</style>
<div class="programme"></div>
<div class="chaine">Documentaire · Les collines</div>
<div class="popup"><div class="titre">${escape(message.title ?? '')}</div><div class="message">${escape(message.msg ?? '')}</div></div>`;
}
