// « Prochain trajet » : GET /trip dit s'il y a un rendez-vous situé bientôt (faut-il demander la position ?), POST /trip
// calcule le trajet depuis la position envoyée dans le corps (jamais dans l'adresse, pour qu'elle n'apparaisse dans
// aucun journal) ou, sans position, depuis la maison. Réservés au téléphone de la personne (`access.ownPhone`) : la
// route ne prend aucun profil, chacun ne voit que son trajet ; un parent ne voit ni la position ni le trajet d'un
// enfant. GET /trip/watch : ce que la notification surveille (diagnostic des réglages), même règle.
// Rendez-vous d'agenda touchés (version 2.1) : GET /trip/events?week=N donne les rendez-vous de la semaine dont le
// lieu est reconnu, POST /trip/event le trajet de l'un d'eux. Un téléphone : les siens et ceux de la famille, position
// prise seulement dans les 3 h ; la tablette : ceux qu'elle affiche déjà (tous les profils), depuis la maison, sans
// position. Un appareil non appairé : rien. La position n'est ni gardée ni journalisée.
import { z } from 'zod';
import type { RoutableEvents, TripResponse, TripStatus, TripWatch } from '../shared/trip.ts';
import { WEEKS_AHEAD } from '../shared/types.ts';
import { type Access, REJECTED_PHONE } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import type { NextTripService, TripViewer } from './services/next-trip.ts';

const positionSchema = z
  .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
  .nullable()
  .catch(null);
const bodySchema = z.object({ position: positionSchema.optional() }).nullable();
const eventBodySchema = z.object({ event: z.string().min(3).max(600), position: positionSchema.optional() });
const weekSchema = z.coerce.number().int().min(0).max(WEEKS_AHEAD);

export const TRIP_DEVICES_ONLY = 'Réservé à la tablette et aux téléphones appairés';

export function createTripApi({ nextTrip, access }: { nextTrip: NextTripService; access: Access }) {
  const api = createRouter();

  /** Le téléphone de la personne (prioritaire), ou la tablette ; sinon refusé. */
  async function viewerOf(c: Parameters<Access['caller']>[0]): Promise<TripViewer> {
    const who = await access.caller(c);
    if (who.rejectedToken) return fail(401, REJECTED_PHONE);
    if (who.device) return { phone: await access.ownPhone(c) };
    if (who.kiosk) return { tablet: true };
    return fail(403, TRIP_DEVICES_ONLY);
  }

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

  api.get('/trip/watch', async (c) => {
    const ownerId = await access.ownPhone(c);
    c.header('Cache-Control', 'no-store');
    return c.json((await nextTrip.watch(ownerId)) satisfies TripWatch);
  });

  api.get('/trip/events', async (c) => {
    const viewer = await viewerOf(c);
    const week = weekSchema.safeParse(c.req.query('week') ?? '0');
    if (!week.success) return fail(400, `week attendu : entier de 0 à ${WEEKS_AHEAD}`);
    const keys = nextTrip.enabled() ? await nextTrip.routable(viewer, week.data) : [];
    return c.json({ keys } satisfies RoutableEvents);
  });

  api.post('/trip/event', async (c) => {
    const viewer = await viewerOf(c);
    const body = await readBody(c, eventBodySchema, 'Rendez-vous illisible');
    c.header('Cache-Control', 'no-store');
    if (!nextTrip.enabled()) return c.json({ enabled: false, trip: null } satisfies TripResponse);
    // La tablette n'envoie pas de position ; si elle en envoyait une, elle serait ignorée (départ : la maison).
    const result = await nextTrip.planEvent(viewer, body.event, 'phone' in viewer ? (body.position ?? null) : null);
    return c.json({ enabled: true, ...result } satisfies TripResponse);
  });

  return api;
}
