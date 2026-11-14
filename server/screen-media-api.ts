// Commandes de ce qui passe sur les télés, depuis la tablette (fonction 6) : pause, reprise, volume et « À table ! »
// (bandeau et pause). Liste des télés sur la tablette seulement, sans rien de personnel (ni l'appli en cours) ; une
// commande demande un parent reconnu devant la tablette, ou le code parent tapé sur la tablette. Volume fixe (barre de
// son par HDMI ARC) : les touches de volume sont refusées, la pause reste. Le téléphone d'un parent a la télécommande
// complète (screen-api.ts).
import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { z } from 'zod';
import { MEDIA_ACTIONS, type MediaScreens } from '../shared/screen.ts';
import { type Access, REMOTE_PARENTS_ONLY } from './access.ts';
import type { Household } from './household.ts';
import { createRouter, fail, readBody } from './http.ts';
import type { PinGate } from './pin-gate.ts';
import { REMOTE_REPORT_MS } from './screen-api.ts';
import { MEDIA_KEYS, VOLUME_FIXED, dinnerEvent, refusesVolume } from './services/screen-media.ts';
import type { ScreenHub } from './services/screens.ts';
import type { ScreenStore } from './sources/screens.ts';

export const PARENT_CODE_NEEDED = 'Un parent : regarde la tablette, ou tape le code parent';

const mediaSchema = z.object({ action: z.enum(MEDIA_ACTIONS), pin: z.string().max(20).optional() });

export function createScreenMediaApi({
  screens,
  hub,
  household,
  access,
  pins,
}: {
  screens: ScreenStore;
  hub: ScreenHub;
  household: Household;
  access: Access;
  pins: PinGate;
}) {
  const api = createRouter();

  /**
   * Qui commande depuis la tablette : le code parent s'il est tapé (pas d'auteur : bandeau signé « HomeHub »), sinon le
   * parent reconnu devant elle. Un enfant reconnu est refusé ; personne : il faut un parent ou le code.
   */
  async function commander(c: Context, pin: string | undefined): Promise<string | null> {
    const who = await access.kiosk(c);
    if (pin) {
      await pins.parent(pin);
      return null;
    }
    if (!who.actorId) return fail(403, PARENT_CODE_NEEDED);
    return household.member(who.actorId)?.parent ? who.actorId : fail(403, REMOTE_PARENTS_ONLY);
  }

  api.get('/screens/media', async (c) => {
    await access.kiosk(c);
    const body: MediaScreens = {
      screens: (await screens.list()).map((s) => {
        const power = hub.power(s.id);
        const state = power === 'offline' ? null : hub.stateOf(s.id);
        return { id: s.id, name: s.name, power, volume: state?.volume ?? null, control: state?.control ?? null };
      }),
      parentCode: (await pins.protection()).parent,
    };
    return c.json(body);
  });

  api.post('/screens/:id/media', async (c) => {
    const { action, pin } = await readBody(c, mediaSchema, 'Commande attendue : pause, play, voldown, volup, mute ou dinner');
    const author = await commander(c, pin);
    const screen = (await screens.list()).find((s) => s.id === c.req.param('id')) ?? fail(404, 'Télé inconnue');
    const event = action === 'dinner' ? dinnerEvent(author ? household.nameOf(author) : null) : { kind: 'key' as const, id: randomUUID(), keys: [MEDIA_KEYS[action]] };
    if (event.kind === 'key' && refusesVolume(hub.stateOf(screen.id)?.volume, event.keys)) return fail(409, VOLUME_FIXED);
    const report = await hub.send(screen.id, event, REMOTE_REPORT_MS);
    return report.ok ? c.json({ ok: true }) : fail(502, `${screen.name} : ${report.reason}`);
  });

  return api;
}
