// Fausse appli HomeHub TV, « Parler en direct » (fonction 9) : comme l'appli (tv-app, LiveTalk.kt), elle rend compte
// de l'événement `talk`, puis demande la voix par attente longue jusqu'à la fin (410) en comptant les octets reçus.
// Ce qu'elle a reçu va dans fake-screen-talk.json (dossier d'état) : les captures en font la maquette de l'écran de la
// télé, le bandeau « Alex vous parle » par-dessus un programme inventé (fakeScreenTv).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScreenTalkEvent } from '../../shared/screen-talk.ts';
import { TALK_SEQ_HEADER } from '../../shared/screen-talk.ts';

export const FAKE_SCREEN_TALK_FILE = 'fake-screen-talk.json';

/** Ce que la fausse télé a entendu : le titre du bandeau, les octets de voix reçus, et si la prise est finie. */
export type FakeScreenTalk = { title: string; bytes: number; ended: string | null };

/** Écoute la prise `event` (en tâche de fond) après en avoir rendu compte. */
export async function fakeTalk(base: string, headers: Record<string, string>, event: ScreenTalkEvent) {
  const dir = process.env.HOMEHUB_STATE_DIR ?? '.';
  const heard: FakeScreenTalk = { title: event.title, bytes: 0, ended: null };
  const save = () => writeFileSync(join(dir, FAKE_SCREEN_TALK_FILE), JSON.stringify(heard));
  save();
  await fetch(`${base}/api/screen/events/${event.id}/report`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) });
  console.log(`Fausse appli HomeHub TV : ${event.title}`);
  let after = 0;
  for (let failures = 0; failures < 4; ) {
    try {
      const res = await fetch(`${base}${event.audio}?after=${after}`, { headers });
      if (res.status === 410 || res.status === 404) {
        heard.ended = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'fin';
        break;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      after = Number(res.headers.get(TALK_SEQ_HEADER) ?? after);
      heard.bytes += (await res.arrayBuffer()).byteLength;
      failures = 0;
      save();
    } catch {
      failures++;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  heard.ended ??= 'HomeHub injoignable';
  save();
  console.log(`Fausse appli HomeHub TV : fin du direct (${heard.bytes} octets, ${heard.ended})`);
}
