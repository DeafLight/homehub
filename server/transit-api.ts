// Page « Transports » : réglages (lieux, trajets, arrêts de l'accueil), recherche d'adresse, d'arrêts et de lignes
// directes. Réservée à la tablette et aux téléphones appairés : les adresses de la famille y sont. Enregistrer : un
// parent. Dépendances absentes (tests) : page indisponible.
import { z } from 'zod';
import type { AddressMatch } from '../shared/types.ts';
import type { Access } from './access.ts';
import type { ConfigProvider } from './config-store.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import { settingsRefused } from './settings.ts';
import type { GtfsSource } from './sources/gtfs.ts';
import { type TransitSettingsStore, transitSettingsInput } from './sources/transit-settings.ts';

export type TransitApiDeps = {
  config: ConfigProvider;
  household: Household;
  access: Access;
  transitSettings?: TransitSettingsStore;
  gtfs?: GtfsSource;
  searchAddress?: (query: string, near?: { lat: number; lon: number }) => Promise<AddressMatch[]>;
  logger?: Pick<Console, 'error'>;
};

const latLonSchema = z
  .string()
  .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/u)
  .transform((v) => {
    const [lat, lon] = v.split(',').map(Number);
    return { lat, lon };
  });

export function createTransitApi({ config, household, access, transitSettings, gtfs, searchAddress, logger = console }: TransitApiDeps) {
  const api = createRouter();
  const settingsStore = () => transitSettings ?? fail(404, 'Réglages des transports indisponibles');
  const gtfsIndex = async () => (gtfs ? await gtfs.index() : null) ?? fail(503, 'Horaires Irigo indisponibles');

  api.get('/transit/settings', async (c) => {
    const store = settingsStore();
    await access.trusted(c);
    return c.json(store.current());
  });

  api.put('/transit/settings', async (c) => {
    const store = settingsStore();
    const settings = await readBody(c, transitSettingsInput, settingsRefused);
    const author = await access.parent(c, 'Seul un parent peut modifier les transports');
    const unknown = Object.keys(settings.commutes).find((id) => !household.isMember(id));
    if (unknown) return fail(400, `Profil inconnu : ${unknown}`);
    return c.json(await store.save(settings, author));
  });

  /** Adresses correspondant à la saisie (Géoplateforme), autour du lieu de la météo s'il est réglé. */
  api.get('/transit/addresses', async (c) => {
    const query = (c.req.query('q') ?? '').trim();
    if (!searchAddress) return fail(404, 'Recherche d’adresse indisponible');
    await access.trusted(c);
    if (query.length < 3 || query.length > 200) return c.json({ addresses: [] });
    const weather = config.current().weather;
    try {
      return c.json({ addresses: await searchAddress(query, weather && { lat: weather.latitude, lon: weather.longitude }) });
    } catch (err) {
      logger.error(`Recherche d'adresse : ${(err as Error).message}`);
      return fail(503, 'Recherche d’adresse indisponible');
    }
  });

  /** Arrêts : par nom (`q`) ou près d'un point (`near=lat,lon`). */
  api.get('/transit/stops', async (c) => {
    await access.trusted(c);
    const index = await gtfsIndex();
    const near = c.req.query('near');
    if (near === undefined) return c.json({ stops: index.search(c.req.query('q') ?? '') });
    const point = latLonSchema.safeParse(near);
    return point.success ? c.json({ stops: index.nearby(point.data) }) : fail(400, 'near attendu : lat,lon');
  });

  /** Lignes directes entre deux points (`from=lat,lon&to=lat,lon`). */
  api.get('/transit/routes', async (c) => {
    await access.trusted(c);
    const from = latLonSchema.safeParse(c.req.query('from'));
    const to = latLonSchema.safeParse(c.req.query('to'));
    if (!from.success || !to.success) return fail(400, 'from et to attendus : lat,lon');
    return c.json({ routes: (await gtfsIndex()).routes(from.data, to.data) });
  });

  return api;
}
