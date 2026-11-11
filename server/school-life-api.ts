// Route de la vie scolaire (notes, absences et retards, messages de l'établissement). Données personnelles des enfants :
// réservées à un parent, reconnu devant la tablette ou sur son téléphone. Ni la tablette sans personne reconnue, ni un
// enfant, ni un appareil non appairé ne les lisent.
import type { Access } from './access.ts';
import { createRouter } from './http.ts';
import type { SchoolLifeService } from './services/school-life.ts';

export const PARENTS_ONLY = 'Vie scolaire : réservée aux parents';

export function createSchoolLifeApi({ schoolLife, access }: { schoolLife: SchoolLifeService; access: Access }) {
  const api = createRouter();

  api.get('/school/life', async (c) => {
    await access.parent(c, PARENTS_ONLY);
    return c.json(await schoolLife.life());
  });

  return api;
}
