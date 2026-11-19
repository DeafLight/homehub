// Protocole entre HomeHub et l'appli Android TV « HomeHub TV » (télé appairée, docs/appli-tele.md) : la télé attend ses
// événements par interrogation longue et rend compte de chacun. Types communs au serveur, au front et, recopiés en
// Kotlin, à l'appli (tv-app/). Toute évolution incompatible change SCREEN_PROTOCOL.
import type { RemoteNowPlaying, ScreenNowPlaying } from './now-playing.ts';
import type { ScreenFilm } from './screen-film.ts';
import type { ScreenMediaEvent } from './screen-media.ts';
import type { ScreenTalkEvent } from './screen-talk.ts';

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
 * Une télé où un parent peut parler en direct (onglet Caméra du téléphone). `on` : allumée, écran compris (éteinte,
 * personne n'entendrait : le direct n'est pas proposé).
 */
export type ScreenTarget = { id: string; name: string; online: boolean; on?: boolean };

/** Demande d'appairage, côté télé : le code à afficher et l'identifiant pour attendre la réponse. */
export type ScreenPairingStart = { id: string; code: string; expiresAt: string };
/** Attente de l'appairage : toujours en attente, ou appairée (jeton donné une seule fois). */
export type ScreenPairingState = { status: 'pending' } | { status: 'paired'; token: string; screen: { id: string; name: string } };

/**
 * Réponses rapides à la télécommande (fonction 10), sous un message écrit : la télé renvoie l'une d'elles
 * (`POST /api/screen/replies/:replyId`), le téléphone de l'expéditeur l'affiche à côté du compte rendu.
 */
export const QUICK_REPLIES = ['ok', 'coming', 'five'] as const;
export type QuickReply = (typeof QUICK_REPLIES)[number];
/** Texte de chaque réponse, sur la télé (recopié dans tv-app, Reponses.kt) comme sur le téléphone. */
export const QUICK_REPLY_LABELS: Record<QuickReply, string> = { ok: 'OK', coming: 'J’arrive', five: '5 minutes' };

/** Une réponse reçue : laquelle, de quelle télé, et quand (heure du serveur). */
export type ScreenReply = { reply: QuickReply; label: string; screen: string; at: string };
/**
 * Attente des réponses d'un message (`GET /api/tv/replies/:replyId?after=n`, téléphone de l'expéditeur) : les réponses
 * reçues dans l'ordre (une par télé, la dernière fait foi), `rev` le nombre de réponses reçues (à redonner en `after`),
 * et `open` tant que la télé peut encore répondre.
 */
export type ScreenReplies = { replies: ScreenReply[]; rev: number; open: boolean };

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
 * `replyId` : la télé propose les réponses rapides (fonction 10).
 */
export type ScreenMessageEvent = { kind: 'message'; id: string; title: string; text: string; seconds: number; replyId?: string; discreet?: boolean };

/**
 * Minuteur de la maison terminé (fonction 3) : bandeau avec « Arrêter » et son court. « Arrêter » à la télécommande
 * arrête le minuteur partout (`POST /api/screen/timers/:timerId/stop`).
 */
export type ScreenTimerEvent = { kind: 'timer'; id: string; timerId: string; title: string; subtitle: string; discreet?: boolean };
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
export type ScreenBusEvent = { kind: 'bus'; id: string; title: string; subtitle: string; seconds: number; discreet?: boolean };

/**
 * Alerte pluie du matin (fonction 14, server/services/rain-alert.ts) : bandeau « Pluie vers 8 h » / « Prenez un
 * parapluie » par-dessus le programme, icône parapluie, pendant `seconds` secondes. Rien de personnel.
 */
export type ScreenRainEvent = { kind: 'rain'; id: string; title: string; subtitle: string; seconds: number; discreet?: boolean };

/*
 * `discreet` (message, timer, bus, rain, reminder) : ajouté par le serveur quand un film passe sur la télé (fonction 15,
 * shared/screen-film.ts) ; l'appli montre alors un petit bandeau en bas à gauche, sans son ni focus.
 */

/** Bandeau de rappel (routine du soir, mots à lire) : shared/screen-reminders.ts. */
export type { ScreenReminderEvent } from './screen-reminders.ts';
import type { ScreenReminderEvent } from './screen-reminders.ts';
export type { ScreenBedtimeEvent } from './bedtime.ts';
import type { ScreenBedtimeEvent } from './bedtime.ts';

/**
 * Séance de sport guidée (fonction 12) : `start` ouvre la page `page` (chemin du front, à charger avec le jeton de la
 * télé) ; `end` la ferme et efface tout, avec un bandeau qui dit que c'est fini (rien de personnel).
 */
export type ScreenWorkoutEvent = { kind: 'workout'; id: string; action: 'start' | 'end'; page: string; notice?: { title: string; subtitle: string } };
/** Page de la séance sur la télé (entrée à part du front, web/tele-sport.html). */
export const SCREEN_WORKOUT_PAGE = '/tele-sport.html';

/**
 * Ouvrir le mode cuisine d'une recette (fonction 13) : la télé ouvre sa vue cuisine, qui lit ensuite elle-même ce
 * qu'elle affiche (GET /api/screen/cook, shared/screen-cook.ts).
 */
export type ScreenCookEvent = { kind: 'cook'; id: string };

export type ScreenEventBody =
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
  | ScreenWorkoutEvent
  | ScreenCookEvent
  | ScreenTalkEvent
  | ScreenBedtimeEvent;
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
  /** Ce que joue la télé (fonction 18, shared/now-playing.ts) ; null : rien, ou accès aux notifications pas accordé ; absent : appli plus ancienne. */
  nowPlaying?: ScreenNowPlaying | null;
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
  /** Ce qui passe (fonction 18) : programme, lecture ou pause, position ; null : rien de connu ; absent : serveur plus ancien. */
  nowPlaying?: RemoteNowPlaying | null;
  /** Mode film (fonction 15) ; absent : serveur plus ancien. */
  film?: ScreenFilm;
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
 * minuteur qui se termine s'affiche et sonne sur la télé. `film` : mode film automatique quand une appli de films est
 * au premier plan (fonction 15, shared/screen-film.ts).
 */
export type ScreenAlerts = {
  timer: boolean;
  film: boolean;
  /** Enceinte Cast (identifiant de cast.devices) qui sonne à la fin d'un minuteur ; null : aucune. */
  timerCast: string | null;
};

/** Le réglage tel que lu par la tablette, avec les enceintes Cast proposées pour la sonnerie du minuteur. */
export type ScreenAlertsView = ScreenAlerts & { castDevices: { id: string; name: string }[] };

/**
 * Commandes de ce qui passe depuis la tablette (fonction 6) : pause, reprise, volume, et « À table ! » (bandeau et
 * pause). Un parent reconnu devant la tablette, ou le code parent.
 */
export const MEDIA_ACTIONS = ['pause', 'play', 'voldown', 'volup', 'mute', 'dinner'] as const;
export type MediaAction = (typeof MEDIA_ACTIONS)[number];

/** Une télé vue de la tablette, pour ses commandes : rien de personnel (ni l'appli en cours). */
export type MediaScreen = { id: string; name: string; power: RemotePower; volume: ScreenVolume | null; control: ScreenControl | null; film?: ScreenFilm };
/** Télés de la tablette, et si un code parent est défini (sinon, seul un parent reconnu commande). */
export type MediaScreens = { screens: MediaScreen[]; parentCode: boolean };

/** Compte rendu de la télé : lecture commencée, ou échec avec sa raison. */
export type ScreenReport = { ok: true } | { ok: false; reason: string };

/**
 * Raison donnée par l'appli quand elle refuse une annonce parce que l'écran est éteint (veille rapide : le réseau
 * reste, mais personne ne verrait ni n'entendrait rien).
 */
export const SCREEN_OFF_REASON = 'écran éteint';

/**
 * Réponses montrées au téléphone, à côté du compte rendu : « Réponse : J’arrive » (une télé), « Réponses : J’arrive
 * (Télé du salon), OK (Télé de la chambre) » (plusieurs) ; null : pas encore de réponse.
 */
export function quickRepliesText(replies: ScreenReply[]): string | null {
  if (!replies.length) return null;
  const screens = new Set(replies.map((r) => r.screen));
  if (screens.size === 1) return `Réponse : ${replies.at(-1)!.label}`;
  return `Réponses : ${replies.map((r) => `${r.label} (${r.screen})`).join(', ')}`;
}
