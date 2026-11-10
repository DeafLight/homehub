// Les membres de la famille d'après la configuration courante (rechargée à chaud) : qui existe, qui est parent, quel
// nom afficher. Les modules demandent ici au lieu de fouiller `config.current().members` chacun à sa façon.
import { FAMILY_ID } from '../shared/types.ts';
import type { AppConfig } from './config.ts';
import type { ConfigProvider } from './config-store.ts';

export type Member = AppConfig['members'][number];

export type Household = {
  members(): Member[];
  /** Le membre `id`, s'il est configuré. */
  member(id: string | null | undefined): Member | undefined;
  /** Vrai pour un membre configuré (pas la famille). */
  isMember(id: string): boolean;
  /** Profils qui ont un dashboard : les membres, puis la famille. */
  ownerIds(): string[];
  /** Vrai pour un membre ou la famille. */
  isOwner(id: string): boolean;
  /** Nom affiché d'un profil (celui de la famille pour FAMILY_ID ; l'identifiant s'il est inconnu). */
  nameOf(id: string): string;
};

export function createHousehold(config: ConfigProvider): Household {
  const members = () => config.current().members;
  const member = (id: string | null | undefined) => (id ? members().find((m) => m.id === id) : undefined);
  const ownerIds = () => [...members().map((m) => m.id), FAMILY_ID];
  return {
    members,
    member,
    isMember: (id) => member(id) !== undefined,
    ownerIds,
    isOwner: (id) => ownerIds().includes(id),
    nameOf: (id) => (id === FAMILY_ID ? config.current().family.name : (member(id)?.name ?? id)),
  };
}
