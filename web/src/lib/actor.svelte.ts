// Personne reconnue devant la tablette : demandée (caméra) au premier geste qui modifie quelque chose, gardée jusqu'au
// retour à l'accueil (ou au bouton « Terminer » du rail). Un parent écrit partout, un enfant sur son profil seulement :
// sinon, un avis « Lecture seule » s'affiche, sans appel au serveur (qui vérifie de toute façon). Sur un téléphone,
// rien à demander : il agit pour son profil, et le serveur décide.
import { canWrite } from '../../../shared/rights.ts';
import { FAMILY_ID, type PublicConfig } from '../../../shared/types.ts';
import { ApiError, type FaceSession } from './api.ts';

type Member = PublicConfig['members'][number];

const NOTICE_MS = 4_000;

export type Actor = {
  /** Personne reconnue, s'il y en a une. */
  readonly current: Member | null;
  /** Vrai pendant que la caméra cherche un visage (FaceCheck affiché). */
  readonly asking: boolean;
  /** Avis « Lecture seule : profil de … », quelques secondes. */
  readonly notice: string | null;
  /** Jeton de session, envoyé avec chaque requête. */
  token(): string | null;
  /**
   * La personne reconnue peut-elle écrire sur `ownerId` (null : sur rien en particulier, il suffit d'être reconnu) ?
   * La fait d'abord reconnaître au besoin.
   */
  allow(ownerId: string | null): Promise<boolean>;
  /** Réponse de FaceCheck. */
  recognized(session: FaceSession): void;
  cancel(): void;
  /** Fin de session (retour à l'accueil, « Terminer »). */
  end(): void;
  /** Erreur de l'API : session inconnue du serveur (redémarré, expirée) : on l'oublie. */
  check(err: unknown): void;
};

export type ActorDeps = {
  config: Pick<PublicConfig, 'members' | 'family'>;
  /** Vrai sur la tablette de la maison. */
  isKiosk(): Promise<boolean>;
  endSession(): Promise<void>;
};

export function createActor({ config, isKiosk, endSession }: ActorDeps): Actor {
  let current = $state<Member | null>(null);
  let asking = $state(false);
  let notice = $state<string | null>(null);
  let token: string | null = null;
  let pending: Promise<Member | null> | null = null;
  let answer: ((member: Member | null) => void) | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const nameOf = (ownerId: string) =>
    ownerId === FAMILY_ID ? config.family.name : (config.members.find((m) => m.id === ownerId)?.name ?? ownerId);

  function ask(): Promise<Member | null> {
    pending ??= new Promise<Member | null>((resolve) => {
      answer = resolve;
      asking = true;
    }).finally(() => {
      pending = null;
      answer = null;
      asking = false;
    });
    return pending;
  }

  function forget() {
    token = null;
    current = null;
  }

  return {
    get current() {
      return current;
    },
    get asking() {
      return asking;
    },
    get notice() {
      return notice;
    },
    token: () => token,

    async allow(ownerId) {
      if (!(await isKiosk())) return true;
      const who = current ?? (await ask());
      if (!who) return false;
      if (ownerId === null || canWrite(who, ownerId)) return true;
      notice = `Lecture seule : profil de ${nameOf(ownerId)}`;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => (notice = null), NOTICE_MS);
      return false;
    },

    recognized(session) {
      token = session.token;
      current = config.members.find((m) => m.id === session.ownerId) ?? null;
      answer?.(current);
    },

    cancel() {
      answer?.(null);
    },

    end() {
      if (!token) return;
      void endSession().catch(() => {}); // sinon, elle expire d'elle-même
      forget();
    },

    check(err) {
      if (err instanceof ApiError && err.identify) forget();
    },
  };
}
