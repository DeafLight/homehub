// Fabrique en PDF les affichettes à scotcher sur le frigo et la poubelle (« scanne avant de ranger / jeter »),
// avec un QR code vers le scanner du téléphone (<adresse>/m/scanner?mode=ranger sur le frigo, ?mode=jete sur la
// poubelle), imprimées par Chrome ou Edge sans fenêtre.
// À lancer depuis le dossier du repo :
//   npm run affichettes                                   adresse fictive https://homehub.example
//   npm run affichettes -- https://<adresse-de-homehub>   les QR ouvrent le scanner de cette adresse
//   npm run affichettes -- <adresse> --sortie <fichier.pdf> --apercu <fichier.png>
// PDF par défaut : affichettes-scan.pdf à la racine du repo (ignoré par git).
// Chrome ou Edge est cherché aux emplacements habituels (Chromium sous Linux) ; sinon : CHROME=<chemin>.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pageHtml, parseArgs, scannerUrl } from './affichettes/page.ts';

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error((e as Error).message);
  console.error('Usage : npm run affichettes -- [https://adresse-de-homehub] [--sortie fichier.pdf] [--apercu fichier.png]');
  process.exit(1);
}

const chromePath = [
  process.env.CHROME,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].find((p): p is string => !!p && existsSync(p));
if (!chromePath) {
  console.error('Ni Edge, ni Chrome, ni Chromium trouvé : CHROME=<chemin> npm run affichettes');
  process.exit(1);
}

const urls = [scannerUrl(opts.base, 'ranger'), scannerUrl(opts.base, 'jete')];
const work = mkdtempSync(join(tmpdir(), 'homehub-affichettes-'));
const html = join(work, 'affichettes.html');
writeFileSync(html, pageHtml(opts.base));

/** Lance le navigateur sans fenêtre (profil jetable : n'interfère pas avec un Edge ou un Chrome ouvert). */
function headless(args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(chromePath!, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${join(work, 'profil')}`,
      // Laisse le temps à la police d'icônes (CDN) d'arriver avant l'impression.
      '--virtual-time-budget=10000',
      ...args, pathToFileURL(html).href,
    ], { stdio: 'ignore' });
    child.on('error', fail);
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`navigateur sorti avec le code ${code}`))));
  });
}

try {
  const pdf = resolve(opts.pdf);
  await headless(['--no-pdf-header-footer', `--print-to-pdf=${pdf}`]);
  if (!existsSync(pdf) || statSync(pdf).size === 0) throw new Error('PDF non écrit');
  console.log(`PDF : ${pdf}`);
  if (opts.png) {
    const png = resolve(opts.png);
    // A4 à 96 ppp : 794 × 1123 px.
    await headless(['--hide-scrollbars', '--window-size=794,1123', `--screenshot=${png}`]);
    console.log(`Aperçu : ${png}`);
  }
  console.log(`QR codes : ${urls.join(' (frigo), ')} (poubelle)`);
  console.log('À imprimer à 100 % (taille réelle, sans ajustement à la page), puis découper selon les pointillés.');
} catch (e) {
  console.error(`Échec : ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
