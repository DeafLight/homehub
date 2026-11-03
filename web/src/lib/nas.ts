// Page « Le NAS » : du relevé brut à ce qu'on affiche, en mots simples pour toute la famille.
import type { NasCheck, NasData, NasStatus } from '../../../shared/types.ts';
import { capitalize, dayDiff, formatTime, pluralize } from './format.ts';

/** ok : vert ; warn : orange ; bad : rouge ; off : gris (arrêté, ou simple information). */
export type NasLevel = 'ok' | 'warn' | 'bad' | 'off';

/** Le relevé est écrit toutes les 5 minutes : au-delà de 20, la tâche cron ne tourne plus. */
export const STALE_AFTER_MS = 20 * 60_000;
const SWAP_WARN = 0.5;
const MEMORY_WARN = 0.9;
const STORAGE_WARN = 0.8;
const STORAGE_BAD = 0.9;
const CPU_TEMP_WARN = 80;
const BATTERY_HEALTH_WARN = 50;
const BATTERY_LOW = 20;

const GIB = 1024 ** 3;
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const weekdayShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** « 12,2 Go », « 928 Go » (Go de 1024³ octets, comme TrueNAS). */
export function formatGb(bytes: number): string {
  const gb = bytes / GIB;
  return `${(gb < 100 ? decimal : integer).format(gb)} Go`;
}

/** Moment passé : « Auj. 03:05 », « Hier 03:05 », « Lun. 02:10 » dans la semaine, sinon « 18 oct. ». */
export function formatPast(date: Date, now: Date): string {
  const diff = dayDiff(date, now);
  if (diff === 0) return `Auj. ${formatTime(date)}`;
  if (diff === 1) return `Hier ${formatTime(date)}`;
  if (diff > 1 && diff < 7) return `${capitalize(weekdayShort.format(date))} ${formatTime(date)}`;
  return dayMonth.format(date);
}

export const isStale = (status: NasStatus, now: Date) => now.getTime() - new Date(status.generatedAt).getTime() > STALE_AFTER_MS;

const problems = (status: NasStatus | null) => status?.checks.filter((c) => c.level !== 'OK') ?? [];

export type NasBanner = { level: NasLevel; title: string; detail: string };

/** Bandeau du haut : l'état du NAS d'après ses contrôles de santé. */
export function nasBanner({ status }: NasData, now: Date): NasBanner {
  if (!status) return { level: 'warn', title: 'État inconnu', detail: 'Aucun relevé du NAS' };
  if (isStale(status, now)) return { level: 'warn', title: 'État inconnu', detail: 'Le dernier relevé est trop ancien' };
  const days = status.uptimeSeconds === null ? null : Math.floor(status.uptimeSeconds / 86_400);
  const uptime = days === null ? null : days === 0 ? 'Allumé aujourd’hui' : `Allumé depuis ${pluralize(days, 'jour')}`;
  const found = problems(status);
  const level = found.some((c) => c.level === 'CRIT') ? 'bad' : found.length ? 'warn' : 'ok';
  const title = level === 'bad' ? 'Problème à régler' : level === 'warn' ? 'À vérifier' : 'Tout fonctionne';
  const alerts = found.length ? pluralize(found.length, 'point à vérifier', 'points à vérifier') : 'aucune alerte';
  return { level, title, detail: [uptime, alerts].filter(Boolean).join(' · ') };
}

export type NasRing = { label: string; percent: number; level: NasLevel; value: string; detail: string };

/** Les anneaux : processeur, mémoire, données, batterie (si le NAS en a une). */
export function nasRings(status: NasStatus): NasRing[] {
  const rings: NasRing[] = [];
  const { cpu, memory, battery } = status;

  if (cpu.percent !== null) {
    const hot = cpu.temperatureC !== null && cpu.temperatureC >= CPU_TEMP_WARN;
    rings.push({
      label: 'Processeur',
      percent: cpu.percent,
      level: hot ? 'warn' : 'ok',
      value: `${Math.round(cpu.percent)} %`,
      detail: cpu.temperatureC === null ? 'en ce moment' : `${Math.round(cpu.temperatureC)} °C`,
    });
  }

  const used = memory.totalBytes - memory.availableBytes;
  const swap = memory.swapTotalBytes ? memory.swapUsedBytes / memory.swapTotalBytes : 0;
  rings.push({
    label: 'Mémoire',
    percent: (100 * used) / memory.totalBytes,
    level: swap >= SWAP_WARN || used / memory.totalBytes >= MEMORY_WARN ? 'warn' : 'ok',
    value: `${Math.round((100 * used) / memory.totalBytes)} %`,
    detail: `${formatGb(used)} sur ${formatGb(memory.totalBytes)}`,
  });

  const pools = status.pools;
  if (pools.length) {
    const size = pools.reduce((sum, p) => sum + p.sizeBytes, 0);
    const allocated = pools.reduce((sum, p) => sum + p.allocatedBytes, 0);
    const ratio = allocated / size;
    rings.push({
      label: 'Données',
      percent: 100 * ratio,
      level: pools.some((p) => !p.healthy) || ratio >= STORAGE_BAD ? 'bad' : ratio >= STORAGE_WARN ? 'warn' : 'ok',
      value: `${Math.round(100 * ratio)} %`,
      detail: `${formatGb(allocated)} sur ${formatGb(size)}`,
    });
  }

  if (battery) {
    rings.push({
      label: 'Batterie',
      percent: battery.percent,
      level: !battery.onAc ? 'bad' : battery.percent < BATTERY_LOW ? 'warn' : 'ok',
      value: `${battery.percent} %`,
      detail: battery.onAc ? 'sur secteur' : 'sur batterie',
    });
  }
  return rings;
}

export type NasWatchItem = { level: NasLevel; title: string; text: string };

/** Titre d'un contrôle de nas-config (healthcheck.sh) ; le détail, technique, reste tel quel. */
const CHECK_TITLES: Record<string, string> = {
  system: 'Système',
  middleware: 'Système',
  alert: 'Alerte TrueNAS',
  alerts: 'Alerte TrueNAS',
  pool: 'Stockage',
  disk: 'Espace disque',
  ports: 'Services',
  http: 'Sites web',
  certificate: 'Certificat HTTPS',
  backup: 'Sauvegarde',
  dns: 'DNS',
  updates: 'Mises à jour',
};

const checkTitle = (check: NasCheck) => CHECK_TITLES[check.check.split(' ')[0]] ?? capitalize(check.check);

const LEVEL_ORDER: Record<NasLevel, number> = { bad: 0, warn: 1, off: 2, ok: 3 };

/** « À surveiller » : problèmes du NAS et de HomeHub, puis les points faibles connus du matériel. */
export function nasWatch({ status, sources }: NasData, now: Date): NasWatchItem[] {
  const items: NasWatchItem[] = [];

  if (!status) {
    items.push({
      level: 'warn',
      title: 'Relevé du NAS absent',
      text: 'HomeHub ne trouve pas nas-status.json : la tâche cron nas-status.sh est-elle installée ?',
    });
  } else if (isStale(status, now)) {
    items.push({
      level: 'warn',
      title: 'Relevé du NAS ancien',
      text: `Dernier relevé : ${formatPast(new Date(status.generatedAt), now)}. La tâche cron nas-status.sh ne tourne plus ?`,
    });
  }

  for (const check of problems(status)) {
    items.push({ level: check.level === 'CRIT' ? 'bad' : 'warn', title: checkTitle(check), text: check.detail });
  }

  for (const source of sources) {
    if (source.ok) continue;
    const since = source.failingSince ? ` depuis ${formatPast(new Date(source.failingSince), now).toLowerCase()}` : '';
    items.push({ level: 'bad', title: `${source.name} : en erreur`, text: `${source.error ?? 'Erreur'}${since}.` });
  }

  if (status) {
    const { memory, battery, cpu } = status;
    if (memory.swapTotalBytes && memory.swapUsedBytes / memory.swapTotalBytes >= SWAP_WARN) {
      items.push({
        level: 'warn',
        title: 'Mémoire juste',
        text: `${formatGb(memory.swapUsedBytes)} de swap utilisés sur ${formatGb(memory.swapTotalBytes)} : le NAS manque de mémoire vive.`,
      });
    }
    if (cpu.temperatureC !== null && cpu.temperatureC >= CPU_TEMP_WARN) {
      items.push({ level: 'warn', title: 'Processeur chaud', text: `${Math.round(cpu.temperatureC)} °C : vérifier la ventilation.` });
    }
    if (battery && !battery.onAc) {
      items.push({ level: 'bad', title: 'Sur batterie', text: `Le NAS n’est plus sur secteur : ${battery.percent} % restants.` });
    }
    if (battery?.healthPercent != null && battery.healthPercent < BATTERY_HEALTH_WARN) {
      items.push({
        level: 'warn',
        title: 'Batterie usée',
        text: `${battery.healthPercent} % de sa capacité d’origine : peu d’autonomie en cas de coupure.`,
      });
    }
    for (const pool of status.pools.filter((p) => !p.redundant)) {
      items.push({
        level: 'off',
        title: status.pools.length > 1 ? `Pool ${pool.name} sur un seul disque` : 'Données sur un seul disque',
        text: 'Pas de redondance : la sauvegarde de la nuit est la seule autre copie.',
      });
    }
  }

  return items.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

export type NasServiceRow = { label: string; level: NasLevel; info: string };

/** Services du NAS ; null si leur état est inconnu. */
export function nasServices(status: NasStatus): NasServiceRow[] | null {
  return (
    status.services?.map(({ label, running, total }) => {
      if (running === total) return { label, level: 'ok', info: 'en marche' };
      if (running === 0) return { label, level: 'off', info: 'arrêté' };
      return { label, level: 'warn', info: `${running} sur ${total}` };
    }) ?? null
  );
}

export type NasEvent = { at: Date; when: string; text: string; level: NasLevel };

/** « Dernièrement » : sauvegarde, vérification des disques, démarrages, du plus récent au plus ancien. */
export function nasTimeline({ status, homehub }: NasData, now: Date): NasEvent[] {
  const events: Omit<NasEvent, 'when'>[] = [
    { at: new Date(homehub.startedAt), text: `HomeHub v${homehub.version} démarré`, level: 'ok' },
  ];
  if (status?.backup) {
    const ok = status.backup.result === 'OK';
    events.push({
      at: new Date(status.backup.at),
      text: ok ? 'Sauvegarde vers le PC réussie' : `Sauvegarde vers le PC en échec (${status.backup.result})`,
      level: ok ? 'ok' : 'bad',
    });
  }
  for (const pool of status?.pools ?? []) {
    if (!pool.lastScrub) continue;
    const errors = pool.lastScrub.errors ?? 0;
    const what = status && status.pools.length > 1 ? `Vérification du pool ${pool.name}` : 'Vérification des données';
    events.push({
      at: new Date(pool.lastScrub.end),
      text: errors ? `${what} : ${pluralize(errors, 'erreur')}` : `${what} sans erreur`,
      level: errors ? 'bad' : 'ok',
    });
  }
  if (status?.bootTime) events.push({ at: new Date(status.bootTime), text: 'Démarrage du NAS', level: 'off' });

  return events
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((event) => ({ ...event, when: formatPast(event.at, now) }));
}
