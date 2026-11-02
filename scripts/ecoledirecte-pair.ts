// Appairage ÉcoleDirecte : se connecte avec le compte Famille, répond à la question de sécurité si elle est posée,
// vérifie l'emploi du temps, puis affiche les lignes à mettre dans app.env (jetons de confiance cn/cv).
// À lancer sur un PC, depuis le dossier du repo :  node scripts/ecoledirecte-pair.ts [prénom de l'élève]
// Le mot de passe est saisi sans écho et n'est ni affiché ni enregistré. Les jetons sont gardés dans
// ~/.homehub-ecoledirecte.json pour les appairages suivants (ils évitent la question).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as readline from 'node:readline';
import { createEcoleDirecteClient, normalizeName, type TrustTokens } from '../server/sources/ecoledirecte.ts';

const STATE_FILE = join(homedir(), '.homehub-ecoledirecte.json');

// Saisie : les lignes sont mises en file pour qu'aucune ne soit perdue ; écho coupé pour le mot de passe.
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

async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const answer = await nextLine();
  muted = false;
  if (hidden && process.stdin.isTTY) process.stdout.write('\n');
  return hidden ? answer : answer.trim();
}

try {
  const wanted = process.argv[2];
  const identifiant = await ask('Identifiant ÉcoleDirecte (compte Famille) : ');
  const motdepasse = await ask('Mot de passe : ', true);
  const saved: TrustTokens | undefined = existsSync(STATE_FILE)
    ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    : undefined;
  console.log(saved ? 'Connexion avec les jetons de confiance enregistrés…' : 'Connexion…');

  const session = await createEcoleDirecteClient().login(
    { identifiant, motdepasse, trust: saved },
    async (question, propositions) => {
      console.log(`\nQuestion de sécurité : ${question}`);
      propositions.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
      const choice = Number(await ask('Numéro de la bonne réponse : ')) - 1;
      if (!propositions[choice]) throw new Error('numéro invalide');
      return propositions[choice];
    },
  );
  if (!session.trust) throw new Error('aucun jeton de confiance reçu');
  writeFileSync(STATE_FILE, JSON.stringify(session.trust), { mode: 0o600 });
  console.log(`Connecté. Élèves du compte : ${session.students.map((s) => s.prenom).join(', ')}`);

  const student = wanted ? session.students.find((s) => normalizeName(s.prenom) === normalizeName(wanted)) : undefined;
  if (wanted && !student) throw new Error(`élève « ${wanted} » introuvable`);
  if (student) {
    const from = new Date();
    const courses = await session.timetable(student.id, from, new Date(from.getTime() + 7 * 86_400_000));
    console.log(`Emploi du temps de ${student.prenom} : ${courses.length} cours sur 7 jours.`);
  }

  console.log(`
À mettre dans apps/homehub/env/app.env sur le NAS (puis recréer le conteneur) :

ECOLEDIRECTE_IDENTIFIANT=${identifiant}
ECOLEDIRECTE_MOTDEPASSE=<le mot de passe>
ECOLEDIRECTE_CN=${session.trust.cn}
ECOLEDIRECTE_CV=${session.trust.cv}
`);
} catch (err) {
  console.error(`\nÉchec : ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
