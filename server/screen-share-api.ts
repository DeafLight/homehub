// Routes du partage d'une photo ou d'une vidéo vers la télé (fonction 11 de l'appli HomeHub TV). Le menu Partager du
// téléphone poste le fichier sur /partager (route hors de l'API, voir shareMediaHandler) ; la page du téléphone, avec
// son jeton, le montre (`GET /api/screens/shared/:id`, `…/file`), liste les télés et l'envoie à l'une d'elles
// (`POST /api/screens/:id/share`), qui le télécharge avec son jeton (`GET /api/screen/media/:token`), l'affiche ou le
// lit, et rend compte. Qui envoie : tout téléphone appairé (access.mediaSender).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SCREEN_PHOTO_SECONDS, SCREEN_VIDEO_MAX_SECONDS, screenMediaTitle, type ShareScreenTarget } from '../shared/screen-media.ts';
import type { Access } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import type { ScreenHub } from './services/screens.ts';
import { checkMedia, MEDIA_EXPIRED, MediaError, type SharedMediaStore } from './services/shared-media.ts';
import type { ScreenStore } from './sources/screens.ts';

/** Attente du compte rendu : la télé télécharge le fichier (jusqu'à 50 Mo par le Wi-Fi) avant de l'afficher. */
export const MEDIA_REPORT_MS = 60_000;

const sendSchema = z.object({ shared: z.string().uuid() });

/**
 * Pour /partager : range un fichier partagé dans la boîte de réception ; rend le paramètre à mettre dans l'adresse de
 * la page du téléphone (`media` : son numéro ; `erreur` : pourquoi il est refusé).
 */
export function shareMediaHandler(store: SharedMediaStore) {
  return async (file: File): Promise<{ media: string } | { erreur: string }> => {
    try {
      return { media: store.receive(checkMedia(new Uint8Array(await file.arrayBuffer()), file.type, file.name)) };
    } catch (err) {
      if (err instanceof MediaError) return { erreur: err.status === 413 ? 'media-trop-lourd' : 'media-format' };
      throw err;
    }
  };
}

export function createScreenShareApi({
  screens,
  hub,
  store,
  household,
  access,
  reportMs = MEDIA_REPORT_MS,
}: {
  screens: ScreenStore;
  hub: ScreenHub;
  store: SharedMediaStore;
  household: Household;
  access: Access;
  reportMs?: number;
}) {
  const api = createRouter();
  const pendingOf = (id: string) => store.pending(id) ?? fail(410, MEDIA_EXPIRED);

  // --- Le téléphone qui partage ---

  api.get('/screens/share-targets', async (c) => {
    await access.mediaSender(c);
    return c.json((await screens.list()).map((s): ShareScreenTarget => ({ id: s.id, name: s.name, online: hub.online(s.id) })));
  });

  api.get('/screens/shared/:id', async (c) => {
    await access.mediaSender(c);
    return c.json(store.describe(c.req.param('id')) ?? fail(410, MEDIA_EXPIRED));
  });

  /** Le fichier lui-même, pour l'aperçu sur le téléphone. */
  api.get('/screens/shared/:id/file', async (c) => {
    await access.mediaSender(c);
    const file = pendingOf(c.req.param('id'));
    return c.body(file.data as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': file.type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(file.data.byteLength),
    });
  });

  api.post('/screens/:id/share', async (c) => {
    const sender = await access.mediaSender(c);
    const { shared } = await readBody(c, sendSchema, 'Corps attendu : { "shared": "…" }');
    const screen = (await screens.list()).find((s) => s.id === c.req.param('id')) ?? fail(404, 'Télé inconnue');
    const file = pendingOf(shared);
    const { token, extension } = store.keep(file);
    const report = await hub.send(
      screen.id,
      {
        kind: 'media',
        id: randomUUID(),
        media: file.kind,
        title: screenMediaTitle(file.kind, household.nameOf(sender.ownerId)),
        url: `/api/screen/media/${token}.${extension}`,
        contentType: file.type,
        seconds: file.kind === 'photo' ? SCREEN_PHOTO_SECONDS : SCREEN_VIDEO_MAX_SECONDS,
      },
      reportMs,
    );
    return report.ok ? c.json({ device: screen.name }) : fail(502, `${screen.name} : ${report.reason}`);
  });

  // --- La télé ---

  api.get('/screen/media/:token', async (c) => {
    await access.screen(c);
    const file = store.clip(c.req.param('token')) ?? fail(404, 'Photo expirée');
    return c.body(file.data as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': file.type,
      'Cache-Control': 'no-store',
      'Content-Length': String(file.data.byteLength),
    });
  });

  return api;
}
