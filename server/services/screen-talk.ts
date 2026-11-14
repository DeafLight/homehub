// Parler en direct à la télé (fonction 9, docs/appli-tele.md section 11), en mémoire seulement. Le téléphone d'un
// parent ouvre une prise de parole : la télé reçoit l'événement `talk` par son attente longue habituelle, baisse le son
// du programme et rend compte. Le téléphone envoie ensuite sa voix par morceaux numérotés (PCM 16 kHz) ; la télé les
// demande par une attente longue courte et reçoit tout ce qui est arrivé depuis, d'un bloc. Fin : le téléphone arrête,
// l'un des deux ne donne plus de nouvelles depuis `idleMs`, ou `camera.maxMinutes` est atteint ; chacun l'apprend à son
// prochain appel (410 et la raison). Une seule voix à la fois par télé. Rien n'est enregistré : les morceaux lus sont
// oubliés, et ceux qui attendent ne gardent que les dernières secondes.
import { randomUUID } from 'node:crypto';
import { TALK_BYTES_PER_SECOND, TALK_RATE, talkTitle, type ScreenTalkStart } from '../../shared/screen-talk.ts';
import type { AppConfig } from '../config.ts';
import { fail } from '../http.ts';
import type { Clock } from '../sources/types.ts';
import type { ScreenHub } from './screens.ts';

/** Sans nouvelles du téléphone (aucun morceau) ou de la télé (aucune demande) pendant ce temps : fin. */
export const TALK_IDLE_MS = 6_000;
/** Attente d'une demande de la télé quand rien n'est arrivé : courte, la voix arrive tous les quarts de seconde. */
export const TALK_WAIT_MS = 3_000;
/** Attente du compte rendu de la télé à l'ouverture (focus audio, lecteur, bandeau). */
export const TALK_REPORT_MS = 6_000;
/** Son gardé au plus en attente de la télé : au-delà, les plus vieux morceaux sont jetés (la télé a pris du retard). */
export const TALK_BACKLOG_BYTES = TALK_BYTES_PER_SECOND * 5;
/** Une prise finie reste connue ce temps : chacun peut encore y lire la raison de la fin. */
const ENDED_TTL_MS = 60_000;

export const TALK_ENDED = 'Prise de parole terminée';
export const TALK_PHONE_GONE = 'Le téléphone ne donne plus de nouvelles';
export const TALK_SCREEN_GONE = 'La télé a arrêté d’écouter';
export const TALK_STOPPED = 'Arrêtée sur le téléphone';

type Talk = {
  id: string;
  screenId: string;
  screenName: string;
  deviceId: string;
  speakerName: string;
  startedAt: number;
  phoneSeenAt: number;
  screenSeenAt: number;
  /** Demandes de la télé en cours (elle est présente tant qu'elle attend). */
  screenPolling: number;
  /** Dernier numéro reçu du téléphone (les doublons et les morceaux en retard sont ignorés). */
  lastSeq: number;
  chunks: { seq: number; data: Uint8Array }[];
  waiters: Set<() => void>;
  /** Raison de la fin, une fois finie. */
  ended: string | null;
  endedAt: number;
};

/** Ce que reçoit la télé : le son arrivé depuis `after` (vide s'il n'y a rien), son dernier numéro, ou la fin. */
export type TalkAudio = { data: Uint8Array; last: number; ended: string | null };

export type ScreenTalk = ReturnType<typeof createScreenTalk>;

export function createScreenTalk({
  clock,
  hub,
  rules,
  idleMs = TALK_IDLE_MS,
  waitMs = TALK_WAIT_MS,
  reportMs = TALK_REPORT_MS,
}: {
  clock: Clock;
  hub: ScreenHub;
  rules: () => AppConfig['camera'];
  idleMs?: number;
  waitMs?: number;
  reportMs?: number;
}) {
  const talks = new Map<string, Talk>();
  const now = () => clock().getTime();

  function end(talk: Talk, reason: string) {
    if (talk.ended !== null) return;
    talk.ended = reason;
    talk.endedAt = now();
    // Les morceaux pas encore lus restent : la télé finit la phrase avant d'apprendre la fin.
    for (const wake of talk.waiters) wake();
    talk.waiters.clear();
  }

  /** Termine les prises dont un côté est parti ou dont le temps est écoulé ; oublie les vieilles prises finies. */
  function sweep() {
    const t = now();
    const { maxMinutes, talk: allowed } = rules();
    for (const talk of talks.values()) {
      if (talk.ended !== null) {
        if (t - talk.endedAt >= ENDED_TTL_MS) talks.delete(talk.id);
      } else if (!allowed) end(talk, 'Parler est désactivé (camera.talk)');
      else if (t - talk.startedAt >= maxMinutes * 60_000) end(talk, `Arrêtée au bout de ${maxMinutes} min`);
      else if (t - talk.phoneSeenAt >= idleMs) end(talk, TALK_PHONE_GONE);
      else if (talk.screenPolling === 0 && t - talk.screenSeenAt >= idleMs) end(talk, TALK_SCREEN_GONE);
    }
  }

  const live = (screenId: string) => [...talks.values()].find((t) => t.screenId === screenId && t.ended === null);

  /**
   * La prise `id` du téléphone `deviceId` (404 si elle n'existe pas ou n'est pas la sienne). Le téléphone qui appelle
   * est là : il compte comme présent avant le ménage.
   */
  function phoneTalk(id: string, deviceId: string): Talk {
    const talk = talks.get(id);
    if (!talk || talk.deviceId !== deviceId) return fail(404, TALK_ENDED);
    if (talk.ended === null) talk.phoneSeenAt = now();
    sweep();
    return talk;
  }

  return {
    sweep,
    /** Prénoms des parents qui parlent à une télé (tests, diagnostic). */
    speakers: () => [...talks.values()].filter((t) => t.ended === null).map((t) => t.speakerName),

    /**
     * Le téléphone `deviceId` commence à parler à la télé : événement `talk` et compte rendu de la télé. Une prise du
     * même téléphone est remplacée ; celle d'un autre parent refuse (409).
     */
    async start({ screenId, screenName, deviceId, speakerName }: { screenId: string; screenName: string; deviceId: string; speakerName: string }): Promise<ScreenTalkStart> {
      sweep();
      const current = live(screenId);
      if (current && current.deviceId !== deviceId) fail(409, `${current.speakerName} parle déjà à ${screenName}`);
      if (current) end(current, 'Remplacée');
      const t = now();
      const id = randomUUID();
      const talk: Talk = {
        id, screenId, screenName, deviceId, speakerName,
        startedAt: t, phoneSeenAt: t, screenSeenAt: t, screenPolling: 0,
        lastSeq: 0, chunks: [], waiters: new Set(), ended: null, endedAt: 0,
      };
      talks.set(id, talk);
      const report = await hub.send(screenId, { kind: 'talk', id, title: talkTitle(speakerName), audio: `/api/screen/talk/${id}`, rate: TALK_RATE }, reportMs);
      if (!report.ok) {
        end(talk, report.reason);
        return fail(502, `${screenName} : ${report.reason}`);
      }
      // Le temps de l'ouverture ne compte pas comme un silence.
      talk.phoneSeenAt = talk.screenSeenAt = now();
      return { id, device: screenName, rate: TALK_RATE, maxSeconds: rules().maxMinutes * 60 };
    },

    /** Un morceau de voix du téléphone ; 410 avec la raison si la prise est finie. */
    push(id: string, deviceId: string, seq: number, data: Uint8Array) {
      const talk = phoneTalk(id, deviceId);
      if (talk.ended !== null) return fail(410, talk.ended);
      if (seq <= talk.lastSeq || data.byteLength === 0) return;
      talk.lastSeq = seq;
      talk.chunks.push({ seq, data });
      // La télé a pris trop de retard : les plus vieux morceaux s'en vont.
      let total = talk.chunks.reduce((sum, c) => sum + c.data.byteLength, 0);
      while (total > TALK_BACKLOG_BYTES && talk.chunks.length > 1) total -= talk.chunks.shift()!.data.byteLength;
      for (const wake of talk.waiters) wake();
      talk.waiters.clear();
    },

    /** Le téléphone arrête (ou quitte l'onglet). Déjà finie : rien à faire. */
    stop(id: string, deviceId: string) {
      const talk = phoneTalk(id, deviceId);
      end(talk, TALK_STOPPED);
    },

    /**
     * La télé `screenId` demande le son après `after` : réponse dès qu'il y en a, vide au bout de `waitMs`. Les
     * morceaux remis sont oubliés. Prise finie : `ended` porte la raison (404 si elle n'est pas pour cette télé).
     */
    async audio(id: string, screenId: string, after: number, abort?: AbortSignal): Promise<TalkAudio> {
      const talk = talks.get(id);
      if (!talk || talk.screenId !== screenId) return fail(404, TALK_ENDED);
      talk.screenSeenAt = now();
      sweep();
      talk.chunks = talk.chunks.filter((c) => c.seq > after);
      talk.screenPolling++;
      try {
        // L'attente se compte en temps réel (l'horloge injectée sert aux délais de silence et de durée).
        const deadline = performance.now() + waitMs;
        while (!talk.chunks.length && talk.ended === null && !abort?.aborted && performance.now() < deadline) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              talk.waiters.delete(done);
              abort?.removeEventListener('abort', done);
              resolve();
            };
            const timer = setTimeout(done, deadline - performance.now());
            talk.waiters.add(done);
            abort?.addEventListener('abort', done, { once: true });
          });
        }
        const chunks = talk.chunks;
        const data = new Uint8Array(chunks.reduce((sum, c) => sum + c.data.byteLength, 0));
        let offset = 0;
        for (const c of chunks) {
          data.set(c.data, offset);
          offset += c.data.byteLength;
        }
        return { data, last: chunks.at(-1)?.seq ?? Math.max(after, 0), ended: chunks.length ? null : talk.ended };
      } finally {
        talk.screenPolling--;
        talk.screenSeenAt = now();
      }
    },
  };
}
