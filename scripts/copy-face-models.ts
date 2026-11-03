// Modèles de reconnaissance faciale de la tablette (bibliothèque Human), copiés de node_modules vers web/public/models
// avant chaque build : servis par HomeHub lui-même, sans CDN. Seuls ceux utilisés : détection, maillage, empreinte du
// visage, et les deux contrôles contre une photo ou un écran.
import { copyFileSync, mkdirSync } from 'node:fs';

const MODELS = ['blazeface', 'facemesh', 'faceres', 'antispoof', 'liveness'];
const from = new URL('../node_modules/@vladmandic/human/models/', import.meta.url);
const to = new URL('../web/public/models/', import.meta.url);

mkdirSync(to, { recursive: true });
for (const model of MODELS) {
  for (const ext of ['json', 'bin']) copyFileSync(new URL(`${model}.${ext}`, from), new URL(`${model}.${ext}`, to));
}
console.log(`modèles de visage copiés : ${MODELS.join(', ')}`);
