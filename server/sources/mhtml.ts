// Page enregistrée par le navigateur (Chrome Android : ⋮ → ⬇, fichier .mhtml) : une archive MIME multipart/related
// qui contient le document HTML et ses ressources (images, feuilles de style…). On en retrouve le document principal
// et l'adresse d'origine, et on peut y prendre une image déjà présente. Rien de ce qui est dans l'archive n'est
// exécuté ni suivi, et aucune requête réseau n'est faite : on ne fait que découper et décoder du texte.
// Taille de l'archive et nombre de parties limités.

export type MhtmlPart = {
  type: string;
  charset: string | null;
  location: string | null;
  /** Contenu décodé (quoted-printable, base64), en octets. */
  body: Uint8Array;
};

export type SavedPage = {
  /** Adresse de la page enregistrée (Snapshot-Content-Location, ou celle du document), si http(s). */
  url: string | null;
  /** Document HTML principal, décodé selon son jeu de caractères. */
  html: string;
  parts: MhtmlPart[];
};

export const MHTML_MAX_BYTES = 25_000_000;
const MAX_PARTS = 3000;

export class MhtmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MhtmlError';
  }
}

type Headers = Map<string, string>;

/** En-têtes MIME (lignes repliées recollées), noms en minuscules. */
function parseHeaders(block: string): Headers {
  const headers: Headers = new Map();
  for (const line of block.replace(/\r?\n[ \t]+/gu, ' ').split(/\r?\n/u)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}

/** Paramètre d'un en-tête (`boundary="…"`, `charset=utf-8`). */
function param(value: string | undefined, name: string): string | null {
  if (!value) return null;
  const match = new RegExp(String.raw`(?:^|;)\s*${name}\s*=\s*(?:"([^"]*)"|([^;\s]+))`, 'iu').exec(value);
  return match ? (match[1] ?? match[2]) : null;
}

/** Sépare en-têtes et corps (première ligne vide). */
function splitEntity(text: string): { headers: Headers; body: string } {
  const match = /\r?\n\r?\n/u.exec(text);
  if (!match) return { headers: parseHeaders(text), body: '' };
  return { headers: parseHeaders(text.slice(0, match.index)), body: text.slice(match.index + match[0].length) };
}

const binary = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'));

/** Quoted-printable (texte lu octet par octet) → octets. */
export function decodeQuotedPrintable(text: string): Uint8Array {
  return binary(text.replace(/=\r?\n/gu, '').replace(/=([0-9A-F]{2})/giu, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))));
}

function decodeBody(body: string, encoding: string): Uint8Array {
  switch (encoding.toLowerCase()) {
    case 'quoted-printable':
      return decodeQuotedPrintable(body);
    case 'base64':
      return Uint8Array.from(Buffer.from(body.replace(/[^A-Za-z0-9+/=]/gu, ''), 'base64'));
    default:
      return binary(body); // 7bit, 8bit, binary
  }
}

function decodeText(body: Uint8Array, charset: string | null): string {
  try {
    return new TextDecoder((charset ?? 'utf-8').toLowerCase()).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

const httpUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

function partOf(headers: Headers, rawBody: string): MhtmlPart {
  const contentType = headers.get('content-type') ?? 'text/plain';
  return {
    type: contentType.split(';')[0].trim().toLowerCase(),
    charset: param(contentType, 'charset'),
    location: headers.get('content-location')?.trim() ?? null,
    body: decodeBody(rawBody, headers.get('content-transfer-encoding') ?? '8bit'),
  };
}

/** Découpe une page enregistrée (.mhtml, .mht) ; erreur si ce n'en est pas une ou s'il n'y a pas de document HTML. */
export function parseMhtml(bytes: Uint8Array): SavedPage {
  if (bytes.byteLength > MHTML_MAX_BYTES) throw new MhtmlError('Page enregistrée trop lourde');
  // Lu octet par octet (latin1) : les parties binaires restent intactes, chaque partie est décodée ensuite.
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const { headers, body } = splitEntity(text.replace(/^﻿/u, ''));
  const contentType = headers.get('content-type') ?? '';
  const snapshot = httpUrl(headers.get('snapshot-content-location'));
  const parts: MhtmlPart[] = [];
  if (/^multipart\//iu.test(contentType)) {
    const boundary = param(contentType, 'boundary');
    if (!boundary) throw new MhtmlError('Page enregistrée illisible (séparateur absent)');
    const delimiter = `--${boundary}`;
    const chunks = body.split(delimiter);
    // Avant le premier séparateur : préambule ; après « --boundary-- » : épilogue.
    for (const chunk of chunks.slice(1)) {
      if (chunk.startsWith('--')) break;
      if (parts.length >= MAX_PARTS) break;
      const entity = splitEntity(chunk.replace(/^[ \t]*\r?\n/u, ''));
      parts.push(partOf(entity.headers, entity.body.replace(/\r?\n$/u, '')));
    }
  } else if (/^text\/html/iu.test(contentType)) {
    parts.push(partOf(headers, body));
  } else {
    throw new MhtmlError('Ce fichier n’est pas une page enregistrée (.mhtml)');
  }
  const htmlParts = parts.filter((p) => p.type === 'text/html' || p.type === 'application/xhtml+xml');
  const startId = param(contentType, 'start');
  const main =
    (snapshot ? htmlParts.find((p) => httpUrl(p.location) === snapshot) : undefined) ??
    (startId ? htmlParts.find((p) => p.location === startId.replace(/^<|>$/gu, '')) : undefined) ??
    htmlParts[0];
  if (!main) throw new MhtmlError('Aucune page dans ce fichier');
  return { url: snapshot ?? httpUrl(main.location), html: decodeText(main.body, main.charset), parts };
}

/** Partie de l'archive enregistrée sous cette adresse (l'image d'une recette, sans aller la chercher sur le site). */
export function partAt(page: SavedPage, url: string): MhtmlPart | null {
  const wanted = httpUrl(url);
  if (!wanted) return null;
  return page.parts.find((p) => httpUrl(p.location) === wanted) ?? null;
}
