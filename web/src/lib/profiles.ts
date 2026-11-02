// Profils affichés : les membres configurés, puis la famille.
import { FAMILY_ID, type PublicConfig } from '../../../shared/types.ts';

export type Profile = {
  id: string;
  name: string;
  color: string;
  isFamily: boolean;
};

export const FAMILY_COLOR = '#9aa1ab';

export function buildProfiles(config: PublicConfig): Profile[] {
  return [
    ...config.members.map((m) => ({ ...m, isFamily: false })),
    { id: FAMILY_ID, name: config.family.name, color: FAMILY_COLOR, isFamily: true },
  ];
}
