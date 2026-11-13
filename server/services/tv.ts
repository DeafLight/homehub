// Envoi d'un message à la télé Android TV : requête HTTP locale à l'appli « Notifications for Android TV » (port 7676
// par défaut), au format de la bibliothèque notifications-android-tv qu'utilise Home Assistant (multipart : msg,
// title, duration, fontsize, position, bkgcolor, transparency, filename). Le message s'affiche au centre, police la
// plus grande, fond noir opaque, par-dessus l'image. Le texte arrive déjà nettoyé (shared/tv.ts).
import type { AppConfig } from '../config.ts';

type TvRules = AppConfig['tv'];

/** Codes de l'appli : position « center », police « max », transparence « 0 % » (fond opaque). */
export const TV_CENTER = '4';
export const TV_FONT_MAX = '3';
export const TV_OPAQUE = '1';
export const TV_BACKGROUND = '#000000';

/** Icône transparente d'un pixel (l'appli attend un fichier `filename`, comme l'envoie la bibliothèque). */
const BLANK_ICON = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP6zwAAAgcBApocMXEAAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);

export class TvError extends Error {
  /** `off` : pas de télé configurée ; `unreachable` : la télé ne répond pas ; `refused` : l'appli a dit non. */
  readonly reason: 'off' | 'unreachable' | 'refused';
  constructor(reason: TvError['reason'], message: string) {
    super(message);
    this.reason = reason;
  }
}

/** « Message d’Alex », « Message de Sam ». */
export function tvTitle(name: string | null): string {
  if (!name) return 'Message';
  return /^[aeiouyhàâäéèêëîïôöûüœæ]/iu.test(name) ? `Message d’${name}` : `Message de ${name}`;
}

export type TvNotifier = {
  /** Envoie `text` (déjà nettoyé) ; rend le temps d'affichage en secondes. Lève TvError sinon. */
  send(text: string, from: string | null): Promise<number>;
};

export function createTvNotifier({
  rules,
  // Le `fetch` global au moment de l'appel : le monde fictif le remplace pour sa fausse télé.
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  timeoutMs = 5_000,
}: {
  rules: () => TvRules;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): TvNotifier {
  return {
    async send(text, from) {
      const tv = rules();
      if (!tv) throw new TvError('off', 'Aucune télé configurée (tv dans homehub.yaml)');
      const form = new FormData();
      form.set('filename', new Blob([BLANK_ICON], { type: 'application/octet-stream' }), 'icon.png');
      form.set('msg', text);
      form.set('title', tvTitle(from));
      form.set('duration', String(tv.seconds));
      form.set('fontsize', TV_FONT_MAX);
      form.set('position', TV_CENTER);
      form.set('bkgcolor', TV_BACKGROUND);
      form.set('transparency', TV_OPAQUE);
      let response: Response;
      try {
        response = await fetchImpl(`http://${tv.host}:${tv.port}/`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        throw new TvError('unreachable', 'La télé ne répond pas : est-elle allumée, avec l’appli Notifications for Android TV ouverte au moins une fois ?');
      }
      if (!response.ok) throw new TvError('refused', `La télé a refusé le message (HTTP ${response.status})`);
      return tv.seconds;
    },
  };
}
