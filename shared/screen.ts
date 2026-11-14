// Protocole entre HomeHub et l'appli Android TV « HomeHub TV » (télé appairée, docs/appli-tele.md) : la télé attend ses
// événements par interrogation longue et rend compte de chacun. Types communs au serveur, au front et, recopiés en
// Kotlin, à l'appli (tv-app/). Toute évolution incompatible change SCREEN_PROTOCOL.
import type { ScreenMediaEvent } from './screen-media.ts';

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
  /** Allumée, en veille (écran éteint, appli joignable) ou injoignable ; absent : serveur plus ancien. */
  power?: RemotePower;
};

/**
 * Une télé où un parent peut envoyer sa voix (onglet Caméra du téléphone). `on` : allumée, écran compris ; `fallback` :
 * appareil où part le message quand elle ne l'est pas (null : aucun).
 */
export type ScreenTarget = { id: string; name: string; online: boolean; on?: boolean; fallback?: string | null };

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
export const REMOTE_KEYS = ['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'playpause', 'pause', 'volup', 'voldown', 'mute', 'play'] as const;
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

/**
 * Message écrit (fonction 2) : bandeau par-dessus ce que montre la télé, `title` (« Message d'Alex ») et `text` (déjà
 * nettoyé par le serveur, shared/tv.ts), affiché `seconds` secondes. Le compte rendu dit si le bandeau s'est affiché.
 */
export type ScreenMessageEvent = { kind: 'message'; id: string; title: string; text: string; seconds: number };

/**
 * Minuteur de la maison terminé (fonction 3) : bandeau avec « Arrêter » et son court. « Arrêter » à la télécommande
 * arrête le minuteur partout (`POST /api/screen/timers/:timerId/stop`).
 */
export type ScreenTimerEvent = { kind: 'timer'; id: string; timerId: string; title: string; subtitle: string };
/** Minuteur arrêté (sur la tablette, un téléphone ou une autre télé) : son bandeau s'en va. */
export type ScreenTimerClearEvent = { kind: 'timer-clear'; id: string; timerId: string };

/** Un minuteur qui tourne encore ; `label` : son nom (« Minuteur » s'il n'en a pas), `endsAt` à l'heure du serveur. */
export type ScreenRunningTimer = { timerId: string; label: string; endsAt: string; durationSeconds: number };
/**
 * Minuteurs en cours de la maison (fonction 3), du plus proche de la fin au plus lointain : la télé montre le temps qui
 * reste en petit, en bas à droite, sans rien à faire à la télécommande (rien n'y prend le focus). Liste complète à chaque lancement ou arrêt, et à une télé qui se reconnecte ; vide :
 * plus rien à montrer. `serverNow` : l'heure du serveur à l'envoi, pour décompter sans dépendre de l'horloge de la télé.
 */
export type ScreenTimersEvent = { kind: 'timers'; id: string; serverNow: string; timers: ScreenRunningTimer[] };

/**
 * Alerte du bus du matin (fonction 4) : bandeau « Bus dans 9 min » par-dessus le programme, `seconds` secondes. Le
 * serveur l'envoie de lui-même (server/services/screen-bus.ts), selon le réglage du trajet (page Transports).
 */
export type ScreenBusEvent = { kind: 'bus'; id: string; title: string; subtitle: string; seconds: number };

/**
 * Alerte pluie du matin (fonction 14, server/services/rain-alert.ts) : bandeau « Pluie vers 8 h » / « Prenez un
 * parapluie » par-dessus le programme, icône parapluie, pendant `seconds` secondes. Rien de personnel.
 */
export type ScreenRainEvent = { kind: 'rain'; id: string; title: string; subtitle: string; seconds: number };

/** Bandeau de rappel (routine du soir, mots à lire) : shared/screen-reminders.ts. */
export type { ScreenReminderEvent } from './screen-reminders.ts';
import type { ScreenReminderEvent } from './screen-reminders.ts';

/**
 * Séance de sport guidée (fonction 12) : `start` ouvre la page `page` (chemin du front, à charger avec le jeton de la
 * télé) ; `end` la ferme et efface tout, avec un bandeau qui dit que c'est fini (rien de personnel).
 */
export type ScreenWorkoutEvent = { kind: 'workout'; id: string; action: 'start' | 'end'; page: string; notice?: { title: string; subtitle: string } };
/** Page de la séance sur la télé (entrée à part du front, web/tele-sport.html). */
export const SCREEN_WORKOUT_PAGE = '/tele-sport.html';

export type ScreenEventBody =
  | ScreenVoiceEvent
  | ScreenKeysEvent
  | ScreenTextEvent
  | ScreenLaunchEvent
  | ScreenPowerEvent
  | ScreenMessageEvent
  | ScreenTimerEvent
  | ScreenTimerClearEvent
  | ScreenTimersEvent
  | ScreenBusEvent
  | ScreenRainEvent
  | ScreenReminderEvent
  | ScreenMediaEvent
  | ScreenWorkoutEvent;
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
  /** Volume réglable par l'appli, ou fixe (barre de son par HDMI ARC) ; absent : appli antérieure à la fonction 6. */
  volume?: ScreenVolume;
};

/**
 * Volume de la télé (fonction 6) : `adjustable`, ou `fixed` quand le système le déclare fixe ou que le son sort par une
 * barre de son (HDMI ARC / eARC) : la télé ne règle pas son volume, la télécommande ne fait alors que la pause.
 */
export const SCREEN_VOLUMES = ['adjustable', 'fixed'] as const;
export type ScreenVolume = (typeof SCREEN_VOLUMES)[number];
/** Touches de volume, refusées quand le volume est fixe. */
export const VOLUME_KEYS: readonly RemoteKey[] = ['volup', 'voldown', 'mute'];

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
  /** Volume réglable ou fixe (null : inconnu, appli trop ancienne ou télé injoignable). */
  volume: ScreenVolume | null;
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

/**
 * Alertes de la maison sur les télés (panneau Télés de la tablette), pour toutes les télés appairées. `timer` : un
 * minuteur qui se termine s'affiche et sonne sur la télé.
 */
export type ScreenAlerts = { timer: boolean };

/**
 * Commandes de ce qui passe depuis la tablette (fonction 6) : pause, reprise, volume, et « À table ! » (bandeau et
 * pause). Un parent reconnu devant la tablette, ou le code parent.
 */
export const MEDIA_ACTIONS = ['pause', 'play', 'voldown', 'volup', 'mute', 'dinner'] as const;
export type MediaAction = (typeof MEDIA_ACTIONS)[number];

/** Une télé vue de la tablette, pour ses commandes : rien de personnel (ni l'appli en cours). */
export type MediaScreen = { id: string; name: string; power: RemotePower; volume: ScreenVolume | null; control: ScreenControl | null };
/** Télés de la tablette, et si un code parent est défini (sinon, seul un parent reconnu commande). */
export type MediaScreens = { screens: MediaScreen[]; parentCode: boolean };

/** Compte rendu de la télé : lecture commencée, ou échec avec sa raison. */
export type ScreenReport = { ok: true } | { ok: false; reason: string };

// --- Télé éteinte : l'annonce part sur un autre appareil (fonction 7 ; le mode film, fonction 15, s'y ajoutera) ---

/**
 * Raison donnée par l'appli quand elle refuse un message vocal parce que l'écran est éteint (veille rapide : le réseau
 * reste, mais personne ne verrait ni n'entendrait rien). Le serveur reconnaît ce refus et bascule vers le secours.
 */
export const SCREEN_OFF_REASON = 'écran éteint';

/** Pourquoi une annonce destinée à la télé part ailleurs : télé injoignable, ou allumée mais écran éteint. */
export type ScreenFallbackReason = 'offline' | 'standby';

/** Réponse à l'envoi d'un message vocal vers une télé : l'appareil qui l'a lu, et la phrase à montrer s'il a basculé. */
export type ScreenVoiceResult = { device: string; fallback: { reason: ScreenFallbackReason; notice: string } | null };

/** Phrase montrée au téléphone quand le message est parti sur l'appareil de secours. */
export const screenFallbackNotice = (device: string) => `Télé éteinte : lu sur ${device}.`;

/**
 * Appareil de secours d'une télé (réglage de la tablette) : `device` est un appareil Cast de `cast.devices`, ou null
 * (aucun : le message échoue comme avant). `auto` : jamais réglé, la première enceinte de la liste s'applique.
 */
export type ScreenFallbackChoice = { id: string; device: string | null; auto: boolean };
/** Réglages des télés et appareils Cast proposés (vide si les messages Cast ne sont pas possibles). */
export type ScreenFallbackSettings = { devices: { id: string; name: string; kind: 'speaker' | 'tv' }[]; screens: ScreenFallbackChoice[] };
