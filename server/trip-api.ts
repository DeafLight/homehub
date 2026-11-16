// « Prochain trajet » du téléphone : GET /trip dit s'il y a un rendez-vous situé bientôt (faut-il demander la
// position ?), POST /trip calcule le trajet depuis la position envoyée dans le corps (jamais dans l'adresse, pour
// qu'elle n'apparaisse dans aucun journal) ou, sans position, depuis la maison. Réservé au téléphone de la personne
// (`access.ownPhone`) : la route ne prend aucun profil, chacun ne voit que son trajet ; un parent ne voit ni la
// position ni le trajet d'un enfant, la tablette rien. La position n'est ni gardée ni journalisée.
import { z } from 'zod';
import type { TripResponse, TripStatus } from '../shared/trip.ts';
import type { Access } from './access.ts';
import { createRouter, readBody } from './http.ts';
import type { NextTripService } from './services/next-trip.ts';

const positionSchema = z
  .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
  .nullable()
  .catch(null);
const bodySchema = z.object({ position: positionSchema.optional() }).nullable();

export function createTripApi({ nextTrip, access }: { nextTrip: NextTripService; access: Access }) {
  const api = createRouter();

  api.get('/trip', async (c) => {
    const ownerId = await access.ownPhone(c);
    const enabled = nextTrip.enabled();
    const status: TripStatus = { enabled, upcoming: enabled && (await nextTrip.destination(ownerId)) !== null };
    return c.json(status);
  });

  api.post('/trip', async (c) => {
    const ownerId = await access.ownPhone(c);
    const body = await readBody(c, bodySchema, 'Position illisible');
    c.header('Cache-Control', 'no-store');
    if (!nextTrip.enabled()) return c.json({ enabled: false, trip: null } satisfies TripResponse);
    const trip = await nextTrip.plan(ownerId, body?.position ?? null, { car: true });
    return c.json({ enabled: true, trip } satisfies TripResponse);
  });

  return api;
}
