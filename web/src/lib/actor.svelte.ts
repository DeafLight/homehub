// Personne reconnue devant la tablette, en continu et sans rien demander : la caméra (Presence.svelte) envoie environ
// une analyse par seconde ; il en faut deux de suite sur la même personne pour la retenir, et elle est oubliée après
// 10 s sans être vue. Un geste qui modifie passe tout de suite si elle peut écrire sur ce profil (un parent :
// partout ; un enfant : le sien) ; si personne n'est encore reconnu, il attend quelques secondes qu'elle le soit
// (petite bulle « Regarde la tablette »). Sinon, un avis « Lecture seule ». Le serveur vérifie de toute façon.
// Sur un téléphone, rien de tout cela : il agit pour son profil, et le serveur décide.
import { canWrite } from '../../../shared/rights.ts';
import { FAMILY_ID, type PublicConfig } from '../../../shared/types.ts';
import { ApiError, type FaceSession } from './api.ts';

type Member = PublicConfig['members'][number];

/** Analyses identiques de suite pour retenir une personne. */
const VOTES = 2;
/** Sans être vue pendant ce délai, la personne est oubliée. */
const ABSENT_MS = 10_000;
/** Attente d'une reconnaissance quand un geste arrive avant elle. */
const WAIT_MS = 6_000;
const NOTICE_MS = 4_000;

export type CameraState = 'off' | 'on' | 'error';

export type Actor = {
  /** Personne reconnue, s'il y en a une. */
  readonly current: Member | null;
  /** Vrai pendant qu'un geste attend une reconnaissance (bulle de la caméra affichée). */
  readonly waiting: boolean;
  /** Avis « Lecture seule : profil de … », quelques secondes. */
  readonly notice: string | null;
  readonly camera: CameraState;
  /** Dernière fois qu'un visage, connu ou non, a été vu (ms) : présence devant la tablette, pour la veille. */
  readonly lastFace: number;
  /** Jeton de session, envoyé avec chaque requête. */
  token(): string | null;
  /** Vrai sur la tablette de la maison (demandé une fois au serveur). */
  isKiosk(): Promise<boolean>;
  /** La personne reconnue peut-elle écrire sur `ownerId` ? Attend d'abord sa reconnaissance au besoin. */
  allow(ownerId: string): Promise<boolean>;
  /** Résultat d'une analyse de la caméra : la personne reconnue par le serveur, ou null (personne, ou inconnu). */
  report(result: FaceSession | null): void;
  setCamera(state: CameraState, error?: string): void;
  /** Un visage est devant la caméra (même trop loin pour savoir qui). */
  sawFace(): void;
  /** Oublie la personne (et ferme sa session sur le serveur). */
  end(): void;
  /** Erreur de l'API : session inconnue du serveur (redémarré, expirée) : on l'oublie. */
  check(err: unknown): void;
};

export type ActorDeps = {
  config: Pick<PublicConfig, 'members' | 'family'>;
  isKiosk(): Promise<boolean>;
  endSession(): Promise<void>;
  now?: () => number;
};

export function createActor({ config, isKiosk, endSession, now = Date.now }: ActorDeps): Actor {
  let current = $state<Member | null>(null);
  let waiting = $state(false);
  let notice = $state<string | null>(null);
  let camera = $state<CameraState>('off');
  let lastFace = $state(0);
  let cameraError: string | null = null;
  let token: string | null = null;
  let lastSeen = 0;
  let candidate: { ownerId: string; streak: number } | null = null;
  let waiters: (() => void)[] = [];
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const nameOf = (ownerId: string) =>
    ownerId === FAMILY_ID ? config.family.name : (config.members.find((m) => m.id === ownerId)?.name ?? ownerId);

  function show(message: string) {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), NOTICE_MS);
  }

  function forget() {
    token = null;
    current = null;
    candidate = null;
  }

  function end() {
    if (token) void endSession().catch(() => {}); // sinon, elle expire d'elle-même
    forget();
  }

  /** Attend une reconnaissance, au plus WAIT_MS. */
  function waitForSomeone(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, WAIT_MS);
      function done() {
        clearTimeout(timer);
        waiters = waiters.filter((w) => w !== done);
        resolve();
      }
      waiters.push(done);
    });
  }

  return {
    get current() {
      return current;
    },
    get waiting() {
      return waiting;
    },
    get notice() {
      return notice;
    },
    get camera() {
      return camera;
    },
    get lastFace() {
      return lastFace;
    },
    token: () => token,
    isKiosk,

    async allow(ownerId) {
      if (!(await isKiosk())) return true;
      if (!current) {
        if (camera === 'error') {
          show(cameraError ?? 'Caméra indisponible');
          return false;
        }
        waiting = true;
        await waitForSomeone();
        waiting = false;
      }
      const who = current as Member | null;
      if (!who) {
        show('Visage non reconnu : regarde la tablette');
        return false;
      }
      if (canWrite(who, ownerId)) return true;
      show(`Lecture seule : profil de ${nameOf(ownerId)}`);
      return false;
    },

    report(result) {
      const t = now();
      if (result && result.ownerId === current?.id) {
        token = result.token;
        lastSeen = t;
        candidate = null;
        return;
      }
      if (result) {
        candidate = candidate?.ownerId === result.ownerId ? { ...candidate, streak: candidate.streak + 1 } : { ownerId: result.ownerId, streak: 1 };
        const member = config.members.find((m) => m.id === result.ownerId);
        if (candidate.streak >= VOTES && member) {
          current = member;
          token = result.token;
          lastSeen = t;
          candidate = null;
          for (const wake of [...waiters]) wake();
        }
        return;
      }
      candidate = null;
      if (current && t - lastSeen > ABSENT_MS) end();
    },

    setCamera(state, error) {
      camera = state;
      cameraError = error ?? null;
      if (state !== 'on') {
        end();
        for (const wake of [...waiters]) wake();
      }
    },

    sawFace() {
      lastFace = now();
    },

    end,

    check(err) {
      if (err instanceof ApiError && err.identify) forget();
    },
  };
}
