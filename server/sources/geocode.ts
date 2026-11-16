// Recherche d'adresse (page « Transports ») : Géoplateforme de l'IGN, successeur de l'API Adresse (BAN). Service
// public, sans clé. L'adresse tapée lui est envoyée ; rien d'autre (ni nom, ni membre). Sert aussi à situer le lieu
// d'un rendez-vous d'agenda pour le « Prochain trajet » du téléphone (`locateAddress`).
import type { AddressMatch } from '../../shared/types.ts';

export const GEOCODE_URL = 'https://data.geopf.fr/geocodage/search';
const TIMEOUT_MS = 10_000;

type Feature = { properties?: { label?: string; score?: number }; geometry?: { coordinates?: [number, number] } };

/** Score minimal de la Géoplateforme (0 à 1) pour croire un lieu d'agenda géocodé (« Prochain trajet »). */
export const SURE_SCORE = 0.7;

/**
 * Lieu d'un rendez-vous d'agenda (champ LOCATION) : la meilleure adresse, seulement si la Géoplateforme en est sûre
 * (score ≥ SURE_SCORE) ; sinon null. Seul le texte du lieu est envoyé (ni titre, ni membre).
 */
export async function locateAddress(
  query: string,
  near?: { lat: number; lon: number },
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<(AddressMatch & { score: number }) | null> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('index', 'address');
  url.searchParams.set('limit', '1');
  if (near) {
    url.searchParams.set('lat', near.lat.toFixed(3));
    url.searchParams.set('lon', near.lon.toFixed(3));
  }
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`recherche d'adresse : HTTP ${res.status}`);
  const body = (await res.json()) as { features?: Feature[] };
  const f = body.features?.[0];
  const [lon, lat] = f?.geometry?.coordinates ?? [];
  const label = f?.properties?.label;
  const score = f?.properties?.score ?? 0;
  if (!label || typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return score >= SURE_SCORE ? { label, lat, lon, score } : null;
}

/** Adresses correspondant à `query`, les plus proches de `near` d'abord (centre de la météo, s'il est réglé). */
export async function searchAddress(
  query: string,
  near?: { lat: number; lon: number },
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<AddressMatch[]> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('index', 'address');
  url.searchParams.set('limit', '5');
  if (near) {
    url.searchParams.set('lat', near.lat.toFixed(3));
    url.searchParams.set('lon', near.lon.toFixed(3));
  }
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`recherche d'adresse : HTTP ${res.status}`);
  const body = (await res.json()) as { features?: Feature[] };
  return (body.features ?? []).flatMap((f) => {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const label = f.properties?.label;
    return label && typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) ? [{ label, lat, lon }] : [];
  });
}
