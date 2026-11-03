// Qui peut modifier quoi, partagé entre le serveur (qui décide) et le front (qui prévient sans attendre le refus).
// Un parent écrit partout ; un enfant seulement sur son propre profil (ni sur celui des autres, ni sur la famille).
import type { Member } from './types.ts';

export function canWrite(actor: Pick<Member, 'id' | 'parent'>, ownerId: string): boolean {
  return actor.parent || actor.id === ownerId;
}
