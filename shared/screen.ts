// Protocole entre HomeHub et l'appli Android TV « HomeHub TV » (télé appairée, docs/appli-tele.md) : la télé attend ses
// événements par interrogation longue et rend compte de chacun. Types communs au serveur, au front et, recopiés en
// Kotlin, à l'appli (tv-app/). Toute évolution incompatible change SCREEN_PROTOCOL.

/** Version du protocole, envoyée par l'appli dans l'en-tête SCREEN_PROTOCOL_HEADER. */
export const SCREEN_PROTOCOL = 1;
export const SCREEN_PROTOCOL_HEADER = 'x-homehub-screen';

/** Code d'appairage affiché sur la télé : 6 caractères sans ambiguïté (ni 0/O, ni 1/I/L). */
export const SCREEN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SCREEN_CODE_LENGTH = 6;

/** Une télé appairée, vue de la tablette. `online` : elle a demandé ses événements il y a moins de 40 s. */
export type Screen = {
  id: string;
  name: string;
  /** Système et version de l'appli annoncés à l'appairage (« Android 10 », « 0.69.0 »). */
  system: string | null;
  app: string | null;
  pairedAt: string;
  lastSeenAt: string;
  online: boolean;
};

/** Une télé où un parent peut envoyer sa voix (onglet Caméra du téléphone). */
export type ScreenTarget = { id: string; name: string; online: boolean };

/** Demande d'appairage, côté télé : le code à afficher et l'identifiant pour attendre la réponse. */
export type ScreenPairingStart = { id: string; code: string; expiresAt: string };
/** Attente de l'appairage : toujours en attente, ou appairée (jeton donné une seule fois). */
export type ScreenPairingState = { status: 'pending' } | { status: 'paired'; token: string; screen: { id: string; name: string } };

/** Message vocal : à télécharger à `audio` (chemin de l'API, avec le jeton de la télé), titre du bandeau. */
export type ScreenVoiceEvent = { kind: 'voice'; id: string; title: string; audio: string; contentType: string };
export type ScreenEvent = { seq: number } & ScreenVoiceEvent;
export type ScreenEvents = { events: ScreenEvent[]; last: number };

/** Compte rendu de la télé : lecture commencée, ou échec avec sa raison. */
export type ScreenReport = { ok: true } | { ok: false; reason: string };
