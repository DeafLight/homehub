// « Prochain trajet » : GET /trip dit s'il y a un rendez-vous situé bientôt (faut-il demander la position ?), POST /trip
// calcule le trajet depuis la position envoyée dans le corps (jamais dans l'adresse, pour qu'elle n'apparaisse dans
// aucun journal) ou, sans position, depuis la maison. Réservés au téléphone de la personne (`access.ownPhone`) : la
// route ne prend aucun profil, chacun ne voit que son trajet ; un parent ne voit ni la position ni le trajet d'un
// enfant. GET /trip/watch : ce que la notification surveille (diagnostic des réglages), même règle.
// Rendez-vous d'agenda touchés (version 2.1) : GET /trip/events?week=N donne les rendez-vous de la semaine dont le
// lieu est reconnu, POST /trip/event le trajet de l'un d'eux. Un téléphone : les siens et ceux de la famille, position
// prise seulement dans les 3 h ; la tablette : ceux qu'elle affiche déjà (tous les profils), depuis la maison, sans
// position. Un appareil non appairé : rien. La position n'est ni gardée ni journalisée.
// Carte en route (version 3) : POST /trip/route, l'itinéraire du prochain trajet avec tracés et courses entières ;
// POST /trip/rides, les nouvelles heures des courses suivies une fois monté. Le téléphone de la personne seulement.
// Positions réelles (version 4) : POST /trip/vehicles, les véhicules des courses que le téléphone envoie (celles de son
// trajet, au plus 4), lus dans le flux VehiclePositions partagé ; jamais tout le flux. La route ne prend ni profil ni
// position, et ne renvoie rien du trajet d'un autre : seulement des véhicules, dont les positions sont publiques.
import { z } from 'zod';
import type { RidesResponse, RoutableEvents, RouteResponse, TripResponse, TripStatus, TripWatch, VehiclesResponse } from '../shared/trip.ts';
import { WEEKS_AHEAD } from '../shared/types.ts';
import { type Access, REJECTED_PHONE } from './access.ts';
import { createRouter, fail, readBody } from './http.ts';
import type { NextTripService, TripViewer } from './services/next-trip.ts';
import { MAX_RIDES } from './services/trip-route.ts';
import { MAX_VEHICLE_TRIPS, vehicleFixes } from './services/trip-vehicles.ts';
import type { Clock } from './sources/types.ts';
import type { VehiclePositionSource } from './sources/vehicle-positions.ts';

const placeSchema = z.object({
  name: z.string().max(200),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  stopId: z.string().max(200).optional(),
});
const ridesSchema = z.object({ rides: z.array(z.object({ tripId: z.string().min(1).max(300), from: placeSchema, to: placeSchema })).max(MAX_RIDES) });

const vehiclesSchema = z.object({ tripIds: z.array(z.string().min(1).max(300)).max(MAX_VEHICLE_TRIPS) });

const positionSchema = z
  .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
  .nullable()
  .catch(null);
const bodySchema = z.object({ position: positionSchema.optional() }).nullable();
const eventBodySchema = z.object({ event: z.string().min(3).max(600), position: positionSchema.optional() });
const weekSchema = z.coerce.number().int().min(0).max(WEEKS_AHEAD);

export const TRIP_DEVICES_ONLY = 'Réservé à la tablette et aux téléphones appairés';

export type TripApiDeps = { nextTrip: NextTripService; access: Access; vehicles?: VehiclePositionSource; clock?: Clock };

export function createTripApi({ nextTrip, access, vehicles, clock = () => new Date() }: TripApiDeps) {
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

  api.post('/trip/route', async (c) => {
    const ownerId = await access.ownPhone(c);
    const body = await readBody(c, bodySchema, 'Position illisible');
    c.header('Cache-Control', 'no-store');
    if (!nextTrip.enabled()) return c.json({ enabled: false, route: null } satisfies RouteResponse);
    return c.json({ enabled: true, route: await nextTrip.route(ownerId, body?.position ?? null) } satisfies RouteResponse);
  });

  api.post('/trip/rides', async (c) => {
    await access.ownPhone(c);
    const body = await readBody(c, ridesSchema, 'Courses illisibles');
    c.header('Cache-Control', 'no-store');
    return c.json({ rides: await nextTrip.rides(body.rides) } satisfies RidesResponse);
  });

  api.post('/trip/vehicles', async (c) => {
    await access.ownPhone(c);
    const body = await readBody(c, vehiclesSchema, 'Courses illisibles');
    c.header('Cache-Control', 'no-store');
    const feed = vehicles && body.tripIds.length > 0 ? await vehicles.vehicles() : [];
    return c.json({ vehicles: vehicleFixes(feed, body.tripIds, clock().getTime()) } satisfies VehiclesResponse);
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
