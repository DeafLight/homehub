import { describe, expect, it } from 'vitest';
import type { NasData, NasStatus } from '../../../shared/types.ts';
import fixture from '../../../server/sources/fixtures/nas-status.json' with { type: 'json' };
import { formatGb, formatPast, nasBanner, nasRings, nasServices, nasTimeline, nasWatch } from './nas.ts';

/** Lundi 2 novembre 2026, 18:00, 5 minutes après le relevé. */
const now = new Date(2026, 10, 2, 18, 0);
const local = (...args: [number, number, number, number, number]) => new Date(...args).toISOString();
const { schema: _schema, ...raw } = fixture as NasStatus & { schema: number };
// Heures du relevé en heure locale : le test ne dépend pas du fuseau de la machine (le build Docker tourne en UTC).
const status: NasStatus = {
  ...raw,
  generatedAt: local(2026, 10, 2, 17, 55),
  bootTime: local(2026, 9, 9, 17, 33),
  backup: { at: local(2026, 10, 2, 3, 5), result: 'OK' },
  pools: raw.pools.map((p) => ({ ...p, lastScrub: { end: local(2026, 9, 18, 0, 2), errors: 0 } })),
};
const data = (patch: Partial<NasStatus> = {}, extra: Partial<NasData> = {}): NasData => ({
  status: { ...status, ...patch },
  sources: [],
  homehub: { version: '0.9.0', startedAt: new Date(2026, 10, 2, 2, 10).toISOString() },
  ...extra,
});

describe('page NAS', () => {
  it('formats', () => {
    expect(formatGb(13_095_292_928)).toBe('12,2 Go');
    expect(formatGb(996_432_412_672)).toBe('928 Go');
    expect(formatPast(new Date(2026, 10, 2, 3, 5), now)).toBe('Auj. 03:05');
    expect(formatPast(new Date(2026, 10, 1, 5, 0), now)).toBe('Hier 05:00');
    expect(formatPast(new Date(2026, 9, 29, 10, 0), now)).toBe('Jeu. 10:00');
    expect(formatPast(new Date(2026, 9, 18, 0, 2), now)).toBe('18 oct.');
  });

  it('bandeau : tout va bien, un contrôle en alerte, relevé absent ou ancien', () => {
    expect(nasBanner(data(), now)).toEqual({ level: 'ok', title: 'Tout fonctionne', detail: 'Allumé depuis 24 jours · aucune alerte' });
    const warn = data({ checks: [{ level: 'WARN', check: 'certificate', detail: '12 days left' }] });
    expect(nasBanner(warn, now)).toMatchObject({ level: 'warn', detail: 'Allumé depuis 24 jours · 1 point à vérifier' });
    const crit = data({ checks: [{ level: 'CRIT', check: 'pool X', detail: 'DEGRADED' }] });
    expect(nasBanner(crit, now).level).toBe('bad');
    expect(nasBanner({ ...data(), status: null }, now)).toMatchObject({ level: 'warn', title: 'État inconnu' });
    expect(nasBanner(data(), new Date(2026, 10, 2, 18, 30)).detail).toBe('Le dernier relevé est trop ancien');
  });

  it('anneaux : processeur, mémoire (orange si le swap déborde), données, batterie', () => {
    expect(nasRings(data().status!).map((r) => [r.label, r.value, r.detail, r.level])).toEqual([
      ['Processeur', '5 %', '58 °C', 'ok'],
      ['Mémoire', '80 %', '12,2 Go sur 15,3 Go', 'warn'],
      ['Données', '11 %', '98,4 Go sur 928 Go', 'ok'],
      ['Batterie', '95 %', 'sur secteur', 'ok'],
    ]);
    expect(nasRings(data({ battery: null }).status!).map((r) => r.label)).not.toContain('Batterie');
  });

  it('à surveiller : erreurs d’abord, puis alertes, puis informations', () => {
    const items = nasWatch(
      data(
        { checks: [{ level: 'WARN', check: 'certificate', detail: '12 days left' }] },
        {
          sources: [
            { name: 'Agenda CAL_B', ok: false, at: now.toISOString(), error: 'HTTP 404', failingSince: new Date(2026, 10, 2, 9, 0).toISOString() },
            { name: 'Open-Meteo', ok: true, at: now.toISOString() },
          ],
        },
      ),
      now,
    );
    expect(items.map((i) => [i.level, i.title])).toEqual([
      ['bad', 'Agenda CAL_B : en erreur'],
      ['warn', 'Certificat HTTPS'],
      ['warn', 'Mémoire juste'],
      ['warn', 'Batterie usée'],
      ['off', 'Données sur un seul disque'],
    ]);
    expect(items[0].text).toBe('HTTP 404 depuis auj. 09:00.');
    expect(nasWatch({ ...data(), status: null }, now)[0].title).toBe('Relevé du NAS absent');
  });

  it('services : en marche, arrêté, en partie', () => {
    const rows = nasServices(data({ services: [{ label: 'Photos', running: 2, total: 4 }, ...status.services!] }).status!)!;
    expect(rows[0]).toEqual({ label: 'Photos', level: 'warn', info: '2 sur 4' });
    expect(rows.find((r) => r.label === 'Satisfactory')).toEqual({ label: 'Satisfactory', level: 'off', info: 'arrêté' });
    expect(nasServices(data({ services: null }).status!)).toBeNull();
  });

  it('dernièrement : du plus récent au plus ancien', () => {
    expect(nasTimeline(data(), now).map((e) => [e.when, e.text])).toEqual([
      ['Auj. 03:05', 'Sauvegarde vers le PC réussie'],
      ['Auj. 02:10', 'HomeHub v0.9.0 démarré'],
      ['18 oct.', 'Vérification des données sans erreur'],
      ['9 oct.', 'Démarrage du NAS'],
    ]);
    const failed = data({ backup: { at: status.backup!.at, result: 'FAIL rsync 23' } });
    expect(nasTimeline(failed, now)[0]).toMatchObject({ level: 'bad', text: 'Sauvegarde vers le PC en échec (FAIL rsync 23)' });
  });
});
