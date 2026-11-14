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

/**
 * Touches de la télécommande du téléphone (fonction 17), dans l'ordre où elles s'envoient ; l'appli les traduit en
 * codes Android (tv-app, Remote.kt). Une rafale de flèches part en un seul événement (touches regroupées).
 */
export const REMOTE_KEYS = ['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'playpause', 'pause', 'volup', 'voldown', 'mute'] as const;
export type RemoteKey = (typeof REMOTE_KEYS)[number];
/** Touches au plus par événement. */
export const REMOTE_MAX_KEYS = 20;
/** Texte tapé au plus (recherche dans une appli de la télé). */
export const REMOTE_TEXT_MAX = 200;

/** Touches à injecter ; `notice` : bandeau à afficher en même temps (« À table ! » met en pause et le dit). */
export type ScreenKeysEvent = { kind: 'key'; id: string; keys: RemoteKey[]; notice?: { title: string; subtitle: string } };
/** Texte à écrire dans le champ qui a le focus ; `submit` : appuyer ensuite sur Entrée (lancer la recherche). */
export type ScreenTextEvent = { kind: 'text'; id: string; text: string; submit: boolean };
/** Appli de la télé à ouvrir, par son paquet (pris dans la liste envoyée par la télé). */
export type ScreenLaunchEvent = { kind: 'launch'; id: string; package: string };
/** Allumer (réveil de l'écran) ou mettre en veille. */
export type ScreenPowerEvent = { kind: 'power'; id: string; on: boolean };

export type ScreenEventBody = ScreenVoiceEvent | ScreenKeysEvent | ScreenTextEvent | ScreenLaunchEvent | ScreenPowerEvent;
export type ScreenEvent = { seq: number } & ScreenEventBody;
export type ScreenEvents = { events: ScreenEvent[]; last: number };

/**
 * Comment l'appli agit sur la télé : `adb` (injecteur lancé par son adb local : toutes les touches, le texte, la
 * veille), `authorize` (adb local en attente du « Toujours autoriser » à la télécommande), `accessibility` (secours :
 * Retour, Accueil, volume et lecture seulement), `none` (rien que les messages).
 */
export const SCREEN_CONTROLS = ['adb', 'authorize', 'accessibility', 'none'] as const;
export type ScreenControl = (typeof SCREEN_CONTROLS)[number];

/** État de la télé, envoyé par l'appli quand il change (`POST /api/screen/state`). */
export type ScreenStateReport = {
  /** Écran allumé (sinon : veille). */
  screenOn: boolean;
  /** Paquet de l'appli au premier plan, s'il est connu. */
  foreground: string | null;
  control: ScreenControl;
  /** Adresses de la télé sur le réseau local : pour retrouver son appareil Cast (allumage). */
  addresses: string[];
};

/** Une appli du lanceur de la télé ; `banner` : sa bannière en PNG, encodée en base64 (sans préfixe). */
export type ScreenApp = { package: string; name: string; banner: string | null };
/** Liste des applis, envoyée par la télé à l'appairage et quand elle change (`PUT /api/screen/apps`). */
export type ScreenAppsReport = { apps: ScreenApp[] };
/** Applis au plus, et taille au plus d'une bannière en base64. */
export const SCREEN_APPS_MAX = 80;
export const SCREEN_BANNER_MAX = 120_000;

/** Télé vue de la télécommande : allumée, en veille (écran éteint, appli joignable) ou injoignable. */
export type RemotePower = 'on' | 'standby' | 'offline';

/** Une télé, pour l'écran Télécommande du téléphone d'un parent. */
export type RemoteScreen = {
  id: string;
  name: string;
  power: RemotePower;
  /** Moyen d'action annoncé par l'appli (null : appli trop ancienne ou télé injoignable). */
  control: ScreenControl | null;
  /** Appli au premier plan, avec son nom s'il est dans la liste. */
  foreground: { package: string; name: string } | null;
  /** Un appareil Cast de la télé est connu : elle peut être allumée même injoignable. */
  canWake: boolean;
  /** Date de la liste des applis (null : pas encore reçue) et leur nombre. */
  appsAt: string | null;
  appCount: number;
};

/** Applis de la télé pour le tiroir du téléphone ; `banner` : adresse data: de la bannière, ou null. */
export type RemoteApp = { package: string; name: string; banner: string | null };
export type RemoteApps = { at: string | null; apps: RemoteApp[] };

/** Réponse à « Allumer » : réveil par l'appli de la télé, ou par son appareil Cast. */
export type RemotePowerResult = { power: RemotePower; via: 'screen' | 'cast' | null };

/** Compte rendu de la télé : lecture commencée, ou échec avec sa raison. */
export type ScreenReport = { ok: true } | { ok: false; reason: string };
