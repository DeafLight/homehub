// Codes PIN des profils, demandés par la tablette avant de relier un téléphone à ce profil ou de le retirer ;
// code parent, accepté pour retirer n'importe quel téléphone.
// À lancer dans le conteneur, sur le NAS :
//   sudo docker exec -it homehub node scripts/set-pin.ts              liste des profils et de leur PIN (oui/non)
//   sudo docker exec -it homehub node scripts/set-pin.ts <profil>     définit ou change le PIN (4 à 8 chiffres)
//   sudo docker exec -it homehub node scripts/set-pin.ts <profil> --supprimer
//   sudo docker exec -it homehub node scripts/set-pin.ts --parent     code parent (--supprimer aussi)
// Le PIN est saisi sans écho, deux fois ; seule son empreinte est enregistrée (pins.json, dossier d'état).
// Le serveur relit le fichier à chaque vérification : rien à redémarrer.
import { join } from 'node:path';
import * as readline from 'node:readline';
import { loadConfig } from '../server/config.ts';
import { createPinStore, PARENT_PIN_ID, PIN_PATTERN } from '../server/sources/pins.ts';

const configPath = process.env.HOMEHUB_CONFIG ?? 'config/homehub.yaml';
const stateDir = process.env.HOMEHUB_STATE_DIR ?? 'state';

// Saisie sans écho : la sortie de readline est coupée pendant la frappe.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
const rlInternals = rl as unknown as { _writeToOutput(s: string): void };
const writeToOutput = rlInternals._writeToOutput.bind(rl);
rlInternals._writeToOutput = (s) => {
  if (!muted) writeToOutput(s);
};
const lines: string[] = [];
const waiters: Array<(line: string) => void> = [];
rl.on('line', (line) => (waiters.length ? waiters.shift()!(line) : lines.push(line)));
rl.on('close', () => waiters.splice(0).forEach((resolve) => resolve('')));
const nextLine = () =>
  lines.length ? Promise.resolve(lines.shift()!) : new Promise<string>((resolve) => waiters.push(resolve));

async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  muted = true;
  const answer = await nextLine();
  muted = false;
  if (process.stdin.isTTY) process.stdout.write('\n');
  return answer.trim();
}

try {
  const [profile, option] = process.argv.slice(2);
  const config = await loadConfig(configPath);
  const pins = createPinStore({ path: join(stateDir, 'pins.json'), clock: () => new Date() });

  if (!profile) {
    const protectedIds = await pins.protectedIds();
    for (const member of config.members) {
      console.log(`${member.id.padEnd(12)} ${member.name.padEnd(12)} PIN : ${protectedIds.includes(member.id) ? 'oui' : 'non'}`);
    }
    console.log(`${'--parent'.padEnd(12)} ${'Code parent'.padEnd(12)} : ${protectedIds.includes(PARENT_PIN_ID) ? 'oui' : 'non'}`);
  } else {
    const member =
      profile === '--parent'
        ? { id: PARENT_PIN_ID, name: 'Code parent' }
        : config.members.find((m) => m.id === profile);
    if (!member) throw new Error(`profil inconnu « ${profile} » (profils : ${config.members.map((m) => m.id).join(', ')})`);

    if (option === '--supprimer') {
      const removed = await pins.remove(member.id);
      if (member.id === PARENT_PIN_ID) console.log(removed ? 'Code parent supprimé.' : 'Pas de code parent.');
      else console.log(removed ? `PIN supprimé pour ${member.name}.` : `${member.name} n'avait pas de PIN.`);
    } else if (option) {
      throw new Error(`option inconnue « ${option} » (seule option : --supprimer)`);
    } else {
      const pin = await askHidden(
        `${member.id === PARENT_PIN_ID ? 'Nouveau code parent' : `Nouveau PIN pour ${member.name}`} (4 à 8 chiffres) : `,
      );
      if (!PIN_PATTERN.test(pin)) throw new Error('le PIN doit faire 4 à 8 chiffres');
      if ((await askHidden('Confirmer : ')) !== pin) throw new Error('les deux saisies diffèrent');
      await pins.set(member.id, pin);
      console.log(
        member.id === PARENT_PIN_ID
          ? 'Code parent enregistré. La tablette l’acceptera pour retirer n’importe quel téléphone.'
          : `PIN enregistré pour ${member.name}. La tablette le demandera avant de relier ou de retirer un téléphone de ce profil.`,
      );
    }
  }
} catch (err) {
  console.error(`Échec : ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
