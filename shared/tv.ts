// Message à la télé : un parent écrit un court texte sur son téléphone, la télé Android TV l'affiche en gros au milieu
// de l'écran, par-dessus ce qu'elle diffuse (appli « Notifications for Android TV » installée sur la télé). Règles
// communes au téléphone (compteur, bouton) et au serveur (qui nettoie toujours le texte lui-même).

/** Longueur maximale d'un message, après nettoyage (il doit se lire d'un coup d'œil, en gros). */
export const TV_MESSAGE_MAX = 140;

/** Réponse de l'envoi : le texte tel qu'il est parti et le temps d'affichage (secondes). */
export type TvMessageSent = { text: string; seconds: number };

// Caractères de contrôle, de mise en forme invisible (largeur nulle, sens d'écriture forcé ; le liant des emojis
// composés, U+200D, est gardé) et chevrons : rien qui puisse cacher, retourner ou mettre en forme le texte sur la télé
// (l'appli lit peut-être du HTML).
const INVISIBLE = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{AD}\u{61C}\u{180E}\u{200B}\u{200C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2060}-\u{206F}\u{FEFF}<>]/gu;

/**
 * Nettoie un message : normalisé (NFC), retours à la ligne et espaces répétées réduits à une espace, caractères
 * invisibles et chevrons retirés. La longueur n'est pas limitée ici (voir tvMessageLength).
 */
export function cleanTvMessage(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(INVISIBLE, '')
    .replace(/ {2,}/gu, ' ')
    .trim();
}

/** Nombre de caractères du message nettoyé, comme les compte la limite (un emoji simple compte pour un). */
export const tvMessageLength = (raw: string) => [...cleanTvMessage(raw)].length;

/** Vrai si le message nettoyé n'est pas vide et tient dans la limite. */
export const tvMessageValid = (raw: string) => {
  const length = tvMessageLength(raw);
  return length > 0 && length <= TV_MESSAGE_MAX;
};
