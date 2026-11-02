// Corrige Pawnote 1.6.2 pour Pronote 2026 (lancé par `npm install`, voir « postinstall » dans package.json).
// Pawnote est la bibliothèque qui parle à Pronote ; sa dernière version ne suit pas les changements de Pronote 2026.
// Les corrections reprennent celles du fork Pawnote-LTS 1.6.4 (github.com/BlocksHub/Pawnote-LTS), sauf la dernière,
// propre aux comptes parents. Chaque remplacement doit trouver son texte exactement une fois :
// sinon (autre version de Pawnote), l'installation échoue plutôt que de livrer une connexion cassée.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const VERSION = '1.6.2';
const MARKER = '/* homehub: Pronote 2026 */';

const PATCHES: { why: string; from: string; to: string }[] = [
  {
    why: 'page de démarrage : Pronote 2026 écrit « Start({...}); }catch », on lit l’objet jusqu’à « }) »',
    from: 't=")}catch",i=e.substring(e.indexOf(s)+s.length,e.indexOf(t))',
    to: 't="})",i=e.substring(e.indexOf(s)+s.length,e.indexOf(t,e.indexOf(s))+1)',
  },
  {
    why: 'clé de connexion : identifiant en minuscules, encodé en UTF-8',
    from: 'return n.util.createBuffer(s+i)}',
    to: 'return new n.util.ByteStringBuffer(n.util.encodeUtf8(s.toLowerCase()+i))}',
  },
  {
    why: 'challenge : rechiffré tel quel, clé et vecteur passés en MD5',
    from: 'try{const e=n.util.decodeUtf8(se.decrypt(s.challenge,t,i)),a=new Array(e.length);for(let s=0;s<e.length;s+=1)s%2==0&&a.push(e.charAt(s));const r=n.util.encodeUtf8(a.join(""));return se.encrypt(r,t,i)}catch{throw new c}',
    to: 'try{const a=n.cipher.createCipher("AES-CBC",n.md.md5.create().update(t.bytes()).digest());a.start({iv:n.md.md5.create().update(i.bytes()).digest()});a.update(new n.util.ByteStringBuffer(n.util.encodeUtf8(s.challenge)));a.finish();return a.output.toHex()}catch{throw new c}',
  },
  {
    why: 'reconnexion : le jeton est aussi envoyé dans loginTokenSAV',
    from: 'loginTokenSAV:""',
    to: 'loginTokenSAV:s.loginTokenSAV??""',
  },
  {
    why: 'reconnexion : passe le jeton à l’identification',
    from: 'reuseMobileAuthentication:!0,requestFromQRCode:!1,useCAS:!1}',
    to: 'reuseMobileAuthentication:!0,requestFromQRCode:!1,useCAS:!1,loginTokenSAV:s.token}',
  },
  {
    why: 'compte parent : chaque requête d’onglet précise l’enfant concerné (« membre »), sinon « Accès refusé »',
    from: 'process(){this.session.information.order++;',
    to: 'process(){this.session.information.order++;{const r=this.session.userResource,g=this.data&&(this.data.Signature||this.data._Signature_);7===this.session.information.accountKind&&r&&g&&void 0!==g.onglet&&!g.membre&&(g.membre={N:r.id,G:4})}',
  },
];

const require = createRequire(import.meta.url);
// Pawnote n'exporte pas son package.json : on remonte depuis dist/index.js.
const root = dirname(dirname(require.resolve('pawnote')));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (version !== VERSION) {
  throw new Error(`patch-pawnote : Pawnote ${version} installé, ce correctif vise la ${VERSION}. À revoir avant de monter de version.`);
}

// HomeHub importe Pawnote en module ES : seul dist/index.mjs est utilisé.
const file = join(root, 'dist', 'index.mjs');
let code = readFileSync(file, 'utf8');
if (code.startsWith(MARKER)) {
  console.log('patch-pawnote : déjà appliqué.');
} else {
  for (const { why, from, to } of PATCHES) {
    const count = code.split(from).length - 1;
    if (count !== 1) throw new Error(`patch-pawnote : texte trouvé ${count} fois au lieu d’une (${why}).`);
    code = code.replace(from, () => to);
  }
  writeFileSync(file, `${MARKER}\n${code}`);
  console.log(`patch-pawnote : ${PATCHES.length} corrections appliquées à Pawnote ${VERSION}.`);
}
