// Reconnaissance faciale de la tablette, sans HTTP : juge chaque analyse sur les membres actuels (un profil retiré
// n'est plus reconnu), ouvre ou prolonge la session de la personne reconnue, apprend de temps en temps une empreinte
// sûre, et tient un journal sobre (chaque reconnaissance nouvelle, un refus toutes les 10 s au plus : la tablette
// envoie une analyse par seconde).
import type { Household } from '../household.ts';
import type { FaceDiagnosis, FaceReadingInput, FaceSession, FaceVerdict } from '../../shared/types.ts';
import { type ActorSessions, type FaceStore, judge, worthLearning } from '../sources/faces.ts';
import type { Clock } from '../sources/types.ts';

/** Une analyse de la tablette : empreinte du visage, et scores contre une photo (`real`) ou un écran (`live`). */
export type FaceReading = FaceReadingInput;

export type FaceRulesConfig = {
  threshold: number;
  margin: number;
  antispoof: number;
  liveness: number;
  sessionMinutes: number;
  learnMinutes: number;
};

/** Reconnu : la session (la même, prolongée, tant que c'est la même personne) ; sinon `far` si c'est une photo ou un écran. */
export type Identification = ({ ok: true } & FaceSession) | { ok: false; far: boolean };

export type { FaceDiagnosis };

export type FaceRecognition = {
  /** `presented` : session déjà présentée par la tablette (en-tête X-Actor-Session). */
  identify(reading: FaceReading, presented: string | undefined): Promise<Identification>;
  /** Verdict et ressemblances, avec les seuils en vigueur ; n'ouvre aucune session et n'apprend rien. */
  diagnose(reading: FaceReading): Promise<FaceDiagnosis>;
};

export type FaceRecognitionDeps = {
  faces: FaceStore;
  sessions: ActorSessions;
  household: Pick<Household, 'isMember'>;
  /** Lues à chaque analyse : la configuration peut être rechargée à chaud. */
  rules: () => FaceRulesConfig;
  clock: Clock;
  logger?: Pick<Console, 'info'>;
};

const REJECT_LOG_MS = 10_000;

export function createFaceRecognition({ faces, sessions, household, rules, clock, logger = console }: FaceRecognitionDeps): FaceRecognition {
  /** Dernière empreinte apprise, par personne. */
  const lastLearned = new Map<string, number>();
  let lastRejectLog = Number.NEGATIVE_INFINITY;

  const describe = ({ result, ownerId, score, next }: FaceVerdict, { real, live }: FaceReading) =>
    `${result} : ${ownerId ?? '-'} ${score}, suivant ${next}, real=${real} live=${live}`;

  async function verdictOf(reading: FaceReading) {
    const scores = (await faces.scores(reading.embedding)).filter((s) => household.isMember(s.ownerId));
    return { scores, verdict: judge(reading, scores, rules()) };
  }

  return {
    async identify(reading, presented) {
      const current = rules();
      const { verdict } = await verdictOf(reading);
      const now = clock().getTime();
      if (verdict.result !== 'ok' || !verdict.ownerId) {
        if (now - lastRejectLog >= REJECT_LOG_MS) {
          lastRejectLog = now;
          logger.info(`visages : non reconnu, ${describe(verdict, reading)}`);
        }
        return { ok: false, far: verdict.result === 'photo' || verdict.result === 'screen' };
      }
      const ownerId = verdict.ownerId;
      const learnedAt = lastLearned.get(ownerId);
      const learnDue = learnedAt === undefined || now - learnedAt >= current.learnMinutes * 60_000;
      if (current.learnMinutes > 0 && worthLearning(verdict, current) && learnDue) {
        lastLearned.set(ownerId, now);
        await faces.learn(ownerId, reading.embedding);
        logger.info(`visages : empreinte apprise, ${describe(verdict, reading)}`);
      }
      if (presented && sessions.get(presented, current.sessionMinutes) === ownerId) return { ok: true, ownerId, token: presented };
      sessions.close(presented);
      logger.info(`visages : reconnu, ${describe(verdict, reading)}`);
      return { ok: true, ownerId, ...sessions.open(ownerId, current.sessionMinutes) };
    },

    async diagnose(reading) {
      const { threshold, margin, antispoof, liveness } = rules();
      return { ...(await verdictOf(reading)), rules: { threshold, margin, antispoof, liveness } };
    },
  };
}
