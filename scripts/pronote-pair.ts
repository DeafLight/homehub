// Appairage Pronote : se connecte avec le QR code de Pronote (comme l'application mobile), vérifie l'emploi du temps
// de l'enfant avec le jeton obtenu, puis enregistre ce jeton dans un fichier à copier dans le dossier d'état de
// HomeHub (pronote.json). Dans Pronote (compte parent) : bouton « QR code de l'application » en haut de la page,
// choisir un code PIN, puis faire une capture d'écran du QR code (valable 10 minutes).
// À lancer sur un PC, depuis le dossier du repo :  node scripts/pronote-pair.ts <capture.png> [prénom] [fichier]
// Le PIN est saisi au clavier. Le jeton n'est jamais affiché ; il change à chaque connexion, donc seul le dernier
// fichier écrit est valable : ne relancer ni ce script ni un autre HomeHub avec ce fichier une fois copié.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as readline from 'node:readline';
// jsqr est un module CommonJS : sous Node, sa fonction est aussi exposée en `.default`.
import jsQR from 'jsqr';
import * as pawnote from 'pawnote';
import { PNG } from 'pngjs';
import {
  createFileStateStore,
  createPawnoteClient,
  matchesChild,
  pawnoteFetcher,
} from '../server/sources/pronote.ts';

const [imagePath, wanted, outPath = join(homedir(), '.homehub-pronote.json')] = process.argv.slice(2);

function readQr(path: string): pawnote.AuthenticationQR {
  const png = PNG.sync.read(readFileSync(path));
  const code = jsQR.default(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!code) throw new Error('aucun QR code lisible dans cette image (capture plus nette ou plus grande ?)');
  return JSON.parse(code.data);
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await new Promise<string>((resolve) => rl.question(question, resolve))).trim();
  } finally {
    rl.close();
  }
}

try {
  if (!imagePath) throw new Error('usage : node scripts/pronote-pair.ts <capture du QR code.png> [prénom] [fichier]');
  const qr = readQr(imagePath);
  console.log(`QR code lu (${new URL(qr.url).host}).`);
  const pin = await ask('Code PIN choisi dans Pronote : ');

  const store = createFileStateStore(outPath);
  const deviceUUID = randomUUID();
  const session = pawnote.createSessionHandle(pawnoteFetcher);
  const refresh = await pawnote.loginQrCode(session, { deviceUUID, pin, qr });
  await store.save({ ...refresh, deviceUUID });
  console.log(`Connecté. Enfants du compte : ${session.user.resources.map((r) => r.name).join(', ')}`);

  // Deuxième connexion, cette fois par jeton : exactement ce que fera HomeHub.
  const client = await createPawnoteClient().login((await store.load())!);
  await store.save(client.state);
  console.log('Reconnexion par jeton : OK.');
  if (wanted) {
    const child = client.children.find((name) => matchesChild(name, wanted));
    if (!child) throw new Error(`enfant « ${wanted} » introuvable`);
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const courses = await client.timetable(child, from, new Date(from.getTime() + 7 * 86_400_000));
    console.log(`Emploi du temps de ${child} : ${courses.length} créneaux sur 7 jours.`);
  }
  console.log(`\nJeton enregistré dans ${outPath}.`);
  console.log('À copier sur le NAS sous le nom pronote.json, dans le dossier d’état de HomeHub (voir README).');
} catch (err) {
  console.error(`\nÉchec : ${(err as Error).message}`);
  process.exitCode = 1;
}
