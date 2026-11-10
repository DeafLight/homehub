// Dates locales en texte, communes au serveur et au front : jour AAAA-MM-JJ et heure HH:MM (heure de la maison).
const pad = (n: number) => String(n).padStart(2, '0');

/** Jour local AAAA-MM-JJ. */
export const localDay = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Heure locale HH:MM. */
export const localTime = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
