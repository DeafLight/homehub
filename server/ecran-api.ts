// Route de l'écran de veille de la télé (appli HomeHub TV, fonction 8) : la page /ecran, ouverte par l'écran de veille
// Android de l'appli (HomeHubDream) avec le jeton de la télé, lit ici météo, agenda et menu du jour. Une télé appairée
// seulement (access.screen) ; rien de plus que ce que la tablette montre déjà à tous.
import type { EcranData } from '../shared/ecran.ts';
import type { Access } from './access.ts';
import { createRouter } from './http.ts';
import type { EcranService } from './services/ecran.ts';

export function createEcranApi({ ecran, access }: { ecran: EcranService; access: Access }) {
  const api = createRouter();

  api.get('/screen/ecran', async (c) => {
    await access.screen(c);
    c.header('Cache-Control', 'no-store');
    return c.json((await ecran.data()) satisfies EcranData);
  });

  return api;
}
