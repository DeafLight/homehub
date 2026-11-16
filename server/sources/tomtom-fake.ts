// Faux TomTom du monde fictif (tests et captures de la doc) : répond à /routing/1/calculateRoute dans la forme de
// l'API TomTom Routing, avec une durée inventée tirée de la distance à vol d'oiseau (30 km/h, plus 2 min de trafic).
// Aucune vraie clé, aucun appel au vrai service.
import { distanceMeters } from '../../shared/trip.ts';

/** Adresse du faux TomTom (tests, monde fictif). */
export const FAKE_TOMTOM_URL = 'http://tomtom.docs.test';

export function fakeTomTomRoute(url: URL): Response {
  const match = /^\/routing\/1\/calculateRoute\/(-?[\d.]+),(-?[\d.]+):(-?[\d.]+),(-?[\d.]+)\/json$/u.exec(url.pathname);
  if (!match || !url.searchParams.get('key')) return new Response('introuvable', { status: 404 });
  const [fromLat, fromLon, toLat, toLon] = match.slice(1).map(Number);
  // Distance par la route : un tiers de plus qu'à vol d'oiseau.
  const meters = Math.round(distanceMeters({ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon }) * 1.35);
  const traffic = 120;
  const seconds = Math.round(meters / (30_000 / 3600)) + traffic;
  const body = { formatVersion: '0.0.12', routes: [{ summary: { lengthInMeters: meters, travelTimeInSeconds: seconds, trafficDelayInSeconds: traffic } }] };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
