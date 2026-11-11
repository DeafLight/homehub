// Imports d'une recette quand le serveur ne peut pas lire la page (site qui refuse la lecture) : par le navigateur de
// la personne, sans jamais contourner le refus. Texte copié de la page, ou page enregistrée (.mhtml) : on en tire un
// aperçu (ce qui a été compris), gardé ici en attendant que la personne le corrige et l'enregistre. Aucune requête
// réseau vers le site d'origine : la photo ne vient que de l'archive elle-même.
//
// Une page enregistrée partagée depuis Chrome arrive par une navigation POST vers /partager, sans le jeton du
// téléphone (il vit dans l'appli) : le fichier attend dans une petite boîte de réception (peu de places, quelques
// minutes, numéro tiré au hasard), puis l'appli le réclame par l'API, où les droits sont vérifiés.
import { randomUUID } from 'node:crypto';
import { parseRecipeText } from '../../shared/recipe-text.ts';
import type { RecipeContent, RecipeOrigin, RecipeSource } from '../../shared/recipes.ts';
import { MhtmlError, parseMhtml, partAt } from '../sources/mhtml.ts';
import { htmlText, readRecipePage, siteName } from '../sources/recipe-page.ts';
import type { Photo } from '../sources/recipes.ts';
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from './recipes.ts';

export { MhtmlError };

/** Ce qu'on a compris d'un texte collé ou d'une page enregistrée. */
export type OfflineRead = { content: RecipeContent; url: string | null; site: string; origin: RecipeOrigin; imageUrl: string | null; photo: Photo | null };

export const PASTED_TEXT_SITE = 'Texte collé';

/** Lien http(s) d'une adresse saisie, sinon null. */
function httpLink(raw: string | null | undefined): string | null {
  const match = /https?:\/\/[^\s<>"']+/iu.exec(raw ?? '')?.[0].replace(/[).,;!?»]+$/u, '');
  if (!match) return null;
  try {
    return new URL(match).toString();
  } catch {
    return null;
  }
}

/** Texte copié d'une page : le lien vient du texte, ou de ce que la personne a donné en plus. */
export function readPastedText(text: string, { url, title }: { url?: string | null; title?: string | null } = {}): OfflineRead {
  const parsed = parseRecipeText(text, { nextId: randomUUID, title: title ?? '' });
  const link = httpLink(url) ?? (parsed.url ? httpLink(parsed.url) : null);
  return { content: parsed.content, url: link, site: link ? siteName(link) : PASTED_TEXT_SITE, origin: 'text', imageUrl: null, photo: null };
}

/**
 * Page enregistrée : le document principal passe par le lecteur habituel (JSON-LD, microdonnées, étapes écrites
 * dans la page) ; sans données de recette, son texte passe par le découpage du texte collé. La photo est celle de
 * l'archive, si elle y est, dans un format d'image ordinaire.
 */
export function readSavedPage(bytes: Uint8Array): OfflineRead {
  const page = parseMhtml(bytes);
  const base = page.url ?? 'https://page-enregistree.invalid/';
  const read = readRecipePage(page.html, base, randomUUID);
  // Sans adresse : le nom donné par la page (og:site_name), sinon « Page enregistrée ».
  const site = !page.url && read.site === new URL(base).hostname ? 'Page enregistrée' : read.site;
  if (!read.found) {
    const text = parseRecipeText(htmlText(page.html), { nextId: randomUUID, title: read.title ?? '' });
    return { content: text.content, url: page.url, site, origin: 'saved-page', imageUrl: null, photo: null };
  }
  const part = read.imageUrl ? partAt(page, read.imageUrl) : null;
  const photo = part && PHOTO_TYPES.test(part.type) && part.body.byteLength > 0 && part.body.byteLength <= PHOTO_MAX_BYTES ? { body: part.body, type: part.type } : null;
  return { content: read.content, url: page.url, site, origin: 'saved-page', imageUrl: page.url ? read.imageUrl : null, photo };
}

/** Source gardée avec la recette : la lecture telle quelle, jamais modifiée. */
export const sourceOf = (read: OfflineRead, importedAt: string): RecipeSource => ({
  url: read.url,
  site: read.site,
  origin: read.origin,
  importedAt,
  imageUrl: read.imageUrl,
  content: read.content,
});

// --- Aperçus en attente ---

export type PendingImports = {
  put(read: OfflineRead): string;
  /** L'aperçu, retiré de l'attente ; null s'il est inconnu ou trop vieux. */
  take(token: string): OfflineRead | null;
};

export function createPendingImports({ ttlMs = 60 * 60_000, max = 30, now = Date.now }: { ttlMs?: number; max?: number; now?: () => number } = {}): PendingImports {
  const entries = new Map<string, { read: OfflineRead; expires: number }>();
  const prune = () => {
    for (const [token, entry] of entries) if (entry.expires <= now()) entries.delete(token);
    while (entries.size >= max) entries.delete(entries.keys().next().value!);
  };
  return {
    put(read) {
      prune();
      const token = randomUUID();
      entries.set(token, { read, expires: now() + ttlMs });
      return token;
    },
    take(token) {
      const entry = entries.get(token);
      entries.delete(token);
      return entry && entry.expires > now() ? entry.read : null;
    },
  };
}

// --- Boîte de réception des fichiers partagés ---

export type SharedFile = { body: Uint8Array; name: string; type: string };

export type ShareInbox = {
  put(file: SharedFile): string;
  take(id: string): SharedFile | null;
};

/** Peu de places et peu de temps : la navigation POST n'est pas authentifiée, elle ne doit pas remplir la mémoire. */
export function createShareInbox({ ttlMs = 10 * 60_000, max = 3, now = Date.now }: { ttlMs?: number; max?: number; now?: () => number } = {}): ShareInbox {
  const entries = new Map<string, { file: SharedFile; expires: number }>();
  return {
    put(file) {
      for (const [id, entry] of entries) if (entry.expires <= now()) entries.delete(id);
      while (entries.size >= max) entries.delete(entries.keys().next().value!);
      const id = randomUUID();
      entries.set(id, { file, expires: now() + ttlMs });
      return id;
    },
    take(id) {
      const entry = entries.get(id);
      entries.delete(id);
      return entry && entry.expires > now() ? entry.file : null;
    },
  };
}
