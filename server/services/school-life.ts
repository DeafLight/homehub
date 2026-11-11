// Vie scolaire des enfants (notes, absences et retards, messagerie des comptes), assemblée pour les parents. Les
// sources (ÉcoleDirecte, Pronote) la chargent avec l'emploi du temps ; ici on prend chaque enfant, on garde les notes
// récentes et on fusionne la messagerie : un compte Famille la donne une fois par enfant, la même pour tous.
import type { SchoolLife, SchoolLifeChild, SchoolMessage, SchoolService } from '../../shared/types.ts';
import type { Logger } from '../config-store.ts';
import type { Household } from '../household.ts';
import type { SchoolSource } from '../sources/types.ts';
import { accessory } from './accessory.ts';

/** Notes gardées par enfant (les plus récentes). */
export const RECENT_GRADES = 20;
/** Messages gardés par service. */
export const RECENT_MESSAGES = 20;

export type SchoolLifeService = {
  /** Enfants qui ont une vie scolaire sur un service (dans l'ordre de la configuration), et leurs messageries. */
  life(): Promise<SchoolLife>;
};

export function createSchoolLifeService({ household, school, logger }: { household: Household; school: SchoolSource; logger: Pick<Logger, 'error'> }): SchoolLifeService {
  return {
    async life() {
      const kids = household.members().filter((m) => !m.parent);
      const loaded = await Promise.all(
        kids.map(async (m) => ({ ownerId: m.id, life: await accessory(logger, `Vie scolaire de ${m.name} indisponible`, async () => (await school.lifeFor?.(m.id)) ?? null, null) })),
      );
      const children: SchoolLifeChild[] = [];
      const inboxes = new Map<SchoolService, Map<string, SchoolMessage>>();
      for (const { ownerId, life } of loaded) {
        if (!life) continue;
        children.push({ ownerId, grades: life.grades && life.grades.slice(0, RECENT_GRADES), attendance: life.attendance });
        if (!life.messages) continue;
        const inbox = inboxes.get(life.messages.service) ?? new Map<string, SchoolMessage>();
        for (const message of life.messages.items) inbox.set(message.id, message);
        inboxes.set(life.messages.service, inbox);
      }
      const messages = [...inboxes].map(([service, inbox]) => ({
        service,
        items: [...inbox.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_MESSAGES),
      }));
      return { children, messages };
    },
  };
}
