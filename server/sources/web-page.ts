// Lecture d'une page web dont l'adresse vient d'un membre de la famille (lien de recette partagé). Le serveur ne doit
// pas devenir un relais vers le réseau de la maison (SSRF) : seulement http et https sur les ports habituels, pas
// d'identifiants dans l'adresse, chaque nom résolu doit donner des adresses publiques (ni locales, ni privées, ni
// réservées), et chaque redirection est revérifiée. Délai et taille limités ; la page est lue par morceaux et coupée
// au-delà de la limite. Limite connue : le nom est résolu juste avant la requête, qui le résout de nouveau ; un nom
// qui changerait d'adresse entre les deux (DNS rebinding) n'est pas couvert. Les hôtes de `allowedHosts` (réglage
// `recipes.allowedHosts`) passent sans ce contrôle d'adresse.
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export type FetchedPage = { url: string; contentType: string; body: Uint8Array };

export type PageFetcher = (url: string, options?: { accept?: string; maxBytes?: number }) => Promise<FetchedPage>;

export type PageErrorKind = 'invalid' | 'forbidden' | 'unreachable' | 'too-large' | 'not-found';

/** Refus ou échec de lecture, avec un message pour l'écran. */
export class PageError extends Error {
  readonly kind: PageErrorKind;
  constructor(kind: PageErrorKind, message: string) {
    super(message);
    this.name = 'PageError';
    this.kind = kind;
  }
}

// Plages qui ne sont pas l'Internet public : boucle locale, réseaux privés, lien local, CGNAT, multidiffusion,
// réservées, et leurs équivalents IPv6 (dont les adresses IPv4 écrites en IPv6).
const BLOCKED = new BlockList();
for (const [base, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED.addSubnet(base, prefix, 'ipv4');
for (const [base, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['64:ff9b:1::', 48], ['2001:db8::', 32],
] as const) BLOCKED.addSubnet(base, prefix, 'ipv6');

/** Adresse de l'Internet public (ni locale, ni privée, ni réservée). */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !BLOCKED.check(address, 'ipv4');
  if (version !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address)?.[1];
  if (mapped) return isPublicAddress(mapped);
  // IPv4 traduite (NAT64, 64:ff9b::/96) : on regarde l'adresse IPv4 qu'elle porte.
  const nat64 = /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/iu.exec(address)?.[1];
  if (nat64) return isPublicAddress(nat64);
  return !BLOCKED.check(address, 'ipv6');
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };
const MAX_REDIRECTS = 4;

export type LookupFn = (host: string) => Promise<string[]>;
const systemLookup: LookupFn = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Adresse acceptable, avant toute requête ; sinon le refus. */
export async function checkTarget(raw: string | URL, { allowedHosts, lookup }: { allowedHosts: readonly string[]; lookup: LookupFn }): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PageError('invalid', 'Adresse illisible');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new PageError('invalid', 'Seules les adresses http et https se lisent');
  if (url.username || url.password) throw new PageError('invalid', 'Adresse avec identifiants refusée');
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (allowedHosts.includes(host)) return url;
  if (url.port && url.port !== DEFAULT_PORTS[url.protocol]) throw new PageError('forbidden', 'Port inhabituel refusé');
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new PageError('forbidden', 'Adresse locale ou privée refusée');
    return url;
  }
  if (!host.includes('.') || /\.(local|localhost|lan|home|internal|intranet|corp|home\.arpa)$/u.test(host)) {
    throw new PageError('forbidden', 'Nom du réseau local refusé');
  }
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new PageError('unreachable', 'Site introuvable');
  }
  if (addresses.length === 0) throw new PageError('unreachable', 'Site introuvable');
  if (!addresses.every(isPublicAddress)) throw new PageError('forbidden', 'Ce nom mène à une adresse locale ou privée');
  return url;
}

/** Lit le corps par morceaux, sans dépasser `maxBytes`. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new PageError('too-large', 'Page trop lourde');
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new PageError('too-large', 'Page trop lourde');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function createPageFetcher({
  fetchFn = (...args) => fetch(...args),
  lookup = systemLookup,
  allowedHosts = () => [],
  userAgent,
  timeoutMs = 10_000,
}: {
  fetchFn?: typeof fetch;
  lookup?: LookupFn;
  allowedHosts?: () => readonly string[];
  userAgent: string;
  timeoutMs?: number;
}): PageFetcher {
  return async (raw, { accept = 'text/html,application/xhtml+xml', maxBytes = 3_000_000 } = {}) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let target = await checkTarget(raw, { allowedHosts: allowedHosts(), lookup });
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await fetchFn(target, { redirect: 'manual', signal, headers: { 'User-Agent': userAgent, Accept: accept, 'Accept-Language': 'fr-FR,fr;q=0.9' } });
      } catch (err) {
        throw new PageError('unreachable', signal.aborted ? 'Le site met trop de temps à répondre' : `Site injoignable (${(err as Error).message})`);
      }
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        if (hop >= MAX_REDIRECTS) throw new PageError('unreachable', 'Trop de redirections');
        target = await checkTarget(new URL(location, target), { allowedHosts: allowedHosts(), lookup });
        continue;
      }
      if (res.status === 404 || res.status === 410) throw new PageError('not-found', 'Page introuvable');
      if (!res.ok) throw new PageError('unreachable', `Le site a refusé la lecture (HTTP ${res.status})`);
      const body = await readCapped(res, maxBytes).catch((err: unknown) => {
        if (err instanceof PageError) throw err;
        throw new PageError('unreachable', signal.aborted ? 'Le site met trop de temps à répondre' : 'Lecture de la page interrompue');
      });
      return { url: target.toString(), contentType: res.headers.get('content-type') ?? '', body };
    }
  };
}
