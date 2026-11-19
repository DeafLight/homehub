// Notifications du téléphone (Web Push) côté navigateur : ce que l'appareil permet (sur iPhone, seulement une fois
// HomeHub ajouté à l'écran d'accueil et ouvert depuis l'icône), service worker (/sw.js), abonnement avec la clé publique
// du serveur, et diagnostic « est-ce que ça marche vraiment ici ? » (permission, abonnement du navigateur comparé à
// celui que garde le serveur) avec l'action qui répare. Règles pures testées à part (push.test.ts).
import type { PushStatus } from '../../../shared/types.ts';

/** Ce que le téléphone permet : prêt, iPhone pas encore installé, connexion non sécurisée, ou pas de notifications. */
export type PushSupport = 'ok' | 'ios-install' | 'insecure' | 'unsupported';

export type PushEnvironment = {
  userAgent: string;
  /** Ouvert depuis l'icône de l'écran d'accueil (display-mode standalone, ou navigator.standalone sur iPhone). */
  standalone: boolean;
  secure: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
};

export const isIos = (userAgent: string) => /iPhone|iPad|iPod/u.test(userAgent);

export function pushSupport(env: PushEnvironment): PushSupport {
  if (!env.secure) return 'insecure';
  if (isIos(env.userAgent) && !env.standalone) return 'ios-install';
  return env.serviceWorker && env.pushManager && env.notification ? 'ok' : 'unsupported';
}

/** L'environnement du navigateur courant. */
export function browserEnvironment(): PushEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    standalone: Boolean(nav.standalone) || matchMedia('(display-mode: standalone)').matches,
    secure: isSecureContext,
    serviceWorker: 'serviceWorker' in nav,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
  };
}

/** Permission des notifications : `null` quand le navigateur n'a pas l'API. */
export type PushPermission = NotificationPermission | null;

/** Ce que le diagnostic regarde : ce que l'appareil permet, la permission, l'abonnement du navigateur, l'état serveur. */
export type PushHealthInput = {
  support: PushSupport;
  permission: PushPermission;
  /** Adresse de push de l'abonnement du navigateur (pushManager.getSubscription), `null` sans abonnement. */
  localEndpoint: string | null;
  /** Réponse de GET /api/push ; `null` tant qu'elle n'est pas arrivée. */
  server: Pick<PushStatus, 'subscribed' | 'endpoint'> | null;
};

/**
 * Verdict, dans l'ordre où on le cherche : pas pris en charge (iPhone pas installé, http, navigateur sans push), permission
 * à demander ou refusée, état du serveur pas encore lu, coupées des deux côtés, abonnement à réparer (le navigateur ou
 * le serveur l'a perdu, ou ils n'ont pas la même adresse), actives.
 */
export type PushHealth =
  | { state: 'ios-install' | 'insecure' | 'unsupported' | 'denied' | 'checking'; action: 'none' }
  | { state: 'ask' | 'off'; action: 'enable' }
  | { state: 'repair'; reason: 'browser' | 'server' | 'mismatch'; action: 'repair' }
  | { state: 'active'; action: 'test' };

/** Diagnostic des notifications de ce téléphone : un état et l'action qui va avec. */
export function pushHealth({ support, permission, localEndpoint, server }: PushHealthInput): PushHealth {
  if (support !== 'ok') return { state: support, action: 'none' };
  if (permission === null) return { state: 'unsupported', action: 'none' };
  if (permission === 'denied') return { state: 'denied', action: 'none' };
  if (permission === 'default') return { state: 'ask', action: 'enable' };
  if (!server) return { state: 'checking', action: 'none' };
  // Coupées des deux côtés : « Couper » a été choisi (ou rien n'a jamais été activé), ce n'est pas une panne.
  if (!localEndpoint && !server.subscribed) return { state: 'off', action: 'enable' };
  if (!localEndpoint) return { state: 'repair', reason: 'browser', action: 'repair' };
  if (!server.subscribed) return { state: 'repair', reason: 'server', action: 'repair' };
  if (server.endpoint !== null && server.endpoint !== localEndpoint) return { state: 'repair', reason: 'mismatch', action: 'repair' };
  return { state: 'active', action: 'test' };
}

/** Clé publique VAPID (base64url) en octets, comme l'attend pushManager.subscribe. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const registration = () => navigator.serviceWorker.register('/sw.js', { scope: '/' });

/**
 * Demande la permission, abonne le navigateur avec la clé du serveur et rend l'abonnement à envoyer au serveur ; lève
 * une erreur lisible si la permission est refusée.
 */
export async function subscribeBrowser(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du téléphone pour HomeHub');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  // Abonnement fait avec une autre clé (serveur réinstallé) : à refaire.
  if (existing) await existing.unsubscribe();
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  return subscription.toJSON();
}

/** Permission et abonnement du navigateur, sans rien demander (relu à l'ouverture et au retour au premier plan). */
export async function browserPushState(): Promise<{ permission: PushPermission; localEndpoint: string | null }> {
  const permission = 'Notification' in window ? Notification.permission : null;
  if (!('serviceWorker' in navigator)) return { permission, localEndpoint: null };
  const reg = await navigator.serviceWorker.getRegistration('/').catch(() => undefined);
  const subscription = await reg?.pushManager?.getSubscription().catch(() => null);
  return { permission, localEndpoint: subscription?.endpoint ?? null };
}

/** Désabonne le navigateur (s'il l'était). */
export async function unsubscribeBrowser(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
}
