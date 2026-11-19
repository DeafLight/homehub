// Notification « Nouveau mot » sur le téléphone (Web Push) : dès qu'un mot est laissé, les téléphones encore appairés
// de son destinataire la reçoivent (un mot à toute la famille : tous les membres abonnés sauf l'auteur), s'ils n'ont pas
// coupé « Nouveaux mots » dans leurs réglages. Le texte du mot est dans la notification : seul le téléphone de la
// personne la reçoit, chiffrée de bout en bout (RFC 8291), la tablette n'affiche rien. Touchée, elle ouvre les mots.
// Feu et oubli : la route répond sans attendre l'envoi ; erreurs au journal, abonnement périmé oublié.
import { FAMILY_ID, type Note } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import type { PushRecord, PushStore } from '../sources/push.ts';
import type { PushMessage, PushResult } from './web-push.ts';

/** Notification d'un mot : « Mot de Sam » (« … pour toute la famille »), le texte du mot en corps. */
export function noteMessage(note: Note, authorName: string): PushMessage {
  return {
    title: `Mot de ${authorName}${note.to === FAMILY_ID ? ' pour toute la famille' : ''}`,
    body: note.text,
    // Un tag par mot : deux mots à la suite font deux notifications, pas une qui remplace l'autre.
    tag: `mot-${note.id}`,
    url: '/m/mots',
  };
}

/** Le téléphone de `ownerId` doit-il recevoir ce mot ? (le destinataire, ou tout membre sauf l'auteur pour la famille) */
export const isRecipient = (note: Note, ownerId: string) =>
  ownerId !== note.from.ownerId && (note.to === FAMILY_ID ? ownerId !== FAMILY_ID : ownerId === note.to);

export type NotePushDeps = {
  store: Pick<PushStore, 'all' | 'unsubscribe'>;
  /** Téléphones encore appairés (un abonnement d'un téléphone retiré est ignoré). */
  devices: () => Promise<{ id: string; ownerId: string }[]>;
  nameOf: (ownerId: string) => string;
  send: (subscription: PushRecord, message: PushMessage) => Promise<PushResult>;
  logger: Logger;
};

export function createNotePush({ store, devices, nameOf, send, logger }: NotePushDeps) {
  /** Envoie le mot aux téléphones concernés ; se termine une fois tous les envois faits. */
  async function notify(note: Note): Promise<void> {
    const paired = new Map((await devices()).map((d) => [d.id, d.ownerId]));
    const targets = (await store.all()).filter((s) => paired.get(s.deviceId) === s.ownerId && s.prefs.notes && isRecipient(note, s.ownerId));
    if (targets.length === 0) return;
    const message = noteMessage(note, note.from.ownerId ? nameOf(note.from.ownerId) : 'HomeHub');
    await Promise.all(
      targets.map(async (sub) => {
        const result = await send(sub, message);
        if (result === 'gone') await store.unsubscribe(sub.deviceId);
        else if (result === 'failed') logger.error('Notification « Nouveau mot » non remise au service de push');
      }),
    );
  }

  return {
    notify,
    /** Feu et oubli : pour la route, qui répond sans attendre. */
    announce(note: Note): void {
      void notify(note).catch((err: unknown) => logger.error(`Notification « Nouveau mot » : ${(err as Error).message}`));
    },
  };
}
