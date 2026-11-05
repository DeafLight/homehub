// Cherche un arrêt Irigo par son nom et donne son identifiant (un par quai, donc par sens), à mettre dans
// homehub.yaml (`transit.stops[].id` ou `commute.stop` d'un membre). Données ouvertes, sans compte ni clé.
// À lancer depuis le dossier du repo :
//   node scripts/irigo-stops.ts <nom>            arrêts dont le nom contient <nom>, avec leurs lignes
//   node scripts/irigo-stops.ts --passages <id>  prochains passages à cet arrêt (pour reconnaître le bon sens)
import { createIrigoClient } from '../server/sources/irigo.ts';

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const client = createIrigoClient();
const [first, second] = process.argv.slice(2);

if (!first) {
  console.error('Usage : node scripts/irigo-stops.ts <nom>  |  node scripts/irigo-stops.ts --passages <id>');
  process.exit(1);
}

if (first === '--passages') {
  if (!second) throw new Error('identifiant d’arrêt manquant');
  const { name, departures } = await client.stopDepartures(second);
  console.log(`${name ?? second} :`);
  if (departures.length === 0) console.log('  aucun passage dans l’heure qui vient (la nuit, c’est normal)');
  for (const d of departures) {
    const time = new Date(d.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    console.log(`  ${time}  ligne ${d.line.padEnd(4)} → ${d.destination}${d.realtime ? '' : ' (horaire prévu)'}${d.cancelled ? ' [supprimé]' : ''}`);
  }
} else {
  const wanted = normalize(process.argv.slice(2).join(' '));
  const stops = (await client.stopPoints()).filter((s) => normalize(s.name).includes(wanted));
  if (stops.length === 0) console.log('Aucun arrêt trouvé.');
  for (const s of stops.sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.id.localeCompare(b.id))) {
    console.log(`${s.id.padEnd(12)} ${s.name}  (lignes ${s.lines.join(', ')})`);
  }
  if (stops.length > 0) {
    console.log('\nUn identifiant par sens : `--passages <id>` montre les destinations pour choisir le bon.');
  }
}
