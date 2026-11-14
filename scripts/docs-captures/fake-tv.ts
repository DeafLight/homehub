// Fausse télé du monde fictif : elle répond à l'adresse de la télé de la configuration fictive (tele.exemple.test),
// comme l'appli « Notifications for Android TV » (POST multipart sur le port 7676), et garde le dernier message reçu
// dans fake-tv.json (dossier d'état). Plus de capture : la télé fictive est appairée avec l'appli HomeHub TV, qui
// reçoit les messages écrits (fake-screen.ts) ; elle reste pour l'ancienne façon, retirée dans une prochaine version.
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
