// Serveur HomeHub des captures : le vrai serveur, dans le monde fictif de fake-world.ts.
// Lancé par scripts/docs-captures.ts (qui fournit PORT, HOMEHUB_CONFIG, HOMEHUB_STATE_DIR, HOMEHUB_NAS_STATUS).
import { installFakeClock, installFakeSources } from './fake-world.ts';

installFakeClock();
installFakeSources();
await import('../../server/index.ts');
