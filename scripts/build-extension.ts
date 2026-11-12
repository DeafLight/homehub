// Construit l'extension « Remplir le panier » dans extension/dist, prête à charger hors boutique (« Charger
// l'extension non empaquetée » dans Chrome ou Edge, « Charger un module complémentaire temporaire » dans Firefox).
// Chaque script (page du site, panneau) devient un seul fichier sans import (Vite, format iife) ; le manifeste prend
// le numéro de version de HomeHub. À lancer depuis le dossier du repo : `npm run build:extension`.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'extension');
const OUT = join(SRC, 'dist');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const name of ['content', 'popup']) {
  await build({
    configFile: false,
    root: ROOT,
    logLevel: 'warn',
    build: {
      outDir: OUT,
      emptyOutDir: false,
      minify: false,
      target: 'es2022',
      lib: { entry: join(SRC, 'src', `${name}.ts`), formats: ['iife'], name: `homehub_${name}`, fileName: () => `${name}.js` },
    },
  });
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8')) as Record<string, unknown>;
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
copyFileSync(join(SRC, 'popup.html'), join(OUT, 'popup.html'));
copyFileSync(join(ROOT, 'web', 'public', 'icon-192.png'), join(OUT, 'icon.png'));
console.log(`Extension ${version} construite dans extension/dist`);
