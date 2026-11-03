// Nom lisible d'un téléphone. Chrome sur Android ne donne que le code du modèle (« SM-S918B ») : on reconnaît la
// marque, et le nom commercial des modèles courants. Un nom choisi sur la tablette n'a pas cette forme et reste
// tel quel. Safari sur iPhone ne donne pas le modèle.

/** Samsung : les 7 premiers caractères du code désignent le modèle, la suite la variante (pays, opérateur). */
const SAMSUNG: Record<string, string> = {
  'SM-G990': 'Galaxy S21 FE',
  'SM-G991': 'Galaxy S21',
  'SM-G996': 'Galaxy S21+',
  'SM-G998': 'Galaxy S21 Ultra',
  'SM-S901': 'Galaxy S22',
  'SM-S906': 'Galaxy S22+',
  'SM-S908': 'Galaxy S22 Ultra',
  'SM-S711': 'Galaxy S23 FE',
  'SM-S911': 'Galaxy S23',
  'SM-S916': 'Galaxy S23+',
  'SM-S918': 'Galaxy S23 Ultra',
  'SM-S721': 'Galaxy S24 FE',
  'SM-S921': 'Galaxy S24',
  'SM-S926': 'Galaxy S24+',
  'SM-S928': 'Galaxy S24 Ultra',
  'SM-S931': 'Galaxy S25',
  'SM-S936': 'Galaxy S25+',
  'SM-S938': 'Galaxy S25 Ultra',
  'SM-A145': 'Galaxy A14',
  'SM-A146': 'Galaxy A14 5G',
  'SM-A155': 'Galaxy A15',
  'SM-A156': 'Galaxy A15 5G',
  'SM-A165': 'Galaxy A16',
  'SM-A166': 'Galaxy A16 5G',
  'SM-A256': 'Galaxy A25 5G',
  'SM-A266': 'Galaxy A26 5G',
  'SM-A346': 'Galaxy A34 5G',
  'SM-A356': 'Galaxy A35 5G',
  'SM-A366': 'Galaxy A36 5G',
  'SM-A525': 'Galaxy A52',
  'SM-A526': 'Galaxy A52 5G',
  'SM-A528': 'Galaxy A52s 5G',
  'SM-A536': 'Galaxy A53 5G',
  'SM-A546': 'Galaxy A54 5G',
  'SM-A556': 'Galaxy A55 5G',
  'SM-A566': 'Galaxy A56 5G',
  'SM-F731': 'Galaxy Z Flip5',
  'SM-F741': 'Galaxy Z Flip6',
  'SM-F946': 'Galaxy Z Fold5',
  'SM-F956': 'Galaxy Z Fold6',
};

export function readableModel(name: string): string {
  const samsung = /^SM-[A-Z]\d{3}/.exec(name);
  if (samsung) return `Samsung ${SAMSUNG[samsung[0]] ?? name}`;
  if (/^Pixel( \d.*| Fold| Tablet)?$/.test(name)) return `Google ${name}`;
  if (/^RMX\d{4}$/.test(name)) return `Realme ${name}`;
  if (/^(Redmi|POCO|Mi) /.test(name)) return `Xiaomi ${name}`;
  return name;
}

/**
 * Système du téléphone, d'après Chrome (`platform`, `platformVersion`). L'agent utilisateur ne s'y fie pas : il
 * annonce toujours « Android 10 », et une version d'iOS figée ; sur iPhone, la version de Safari suit celle d'iOS.
 */
export function systemName(userAgent: string, platform?: string, platformVersion?: string): string | null {
  const major = platformVersion?.split('.')[0];
  if (platform && major && major !== '0') return `${platform} ${major}`;
  if (/iPhone/.test(userAgent)) {
    const safari = /Version\/(\d+)/.exec(userAgent);
    return safari ? `iOS ${safari[1]}` : 'iOS';
  }
  return platform || null;
}
