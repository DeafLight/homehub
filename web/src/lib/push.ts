// Notifications du téléphone (Web Push, « Pars dans 5 min ») côté navigateur : ce que l'appareil permet (sur iPhone,
// seulement une fois HomeHub ajouté à l'écran d'accueil et ouvert depuis l'icône), service worker (/sw.js) et
// abonnement avec la clé publique du serveur. Règles pures testées à part (push.test.ts).

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

/** Désabonne le navigateur (s'il l'était). */
export async function unsubscribeBrowser(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
}
