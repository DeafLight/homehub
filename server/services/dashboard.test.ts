import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAMILY_ID } from '../../shared/types.ts';
import { parseConfig } from '../config.ts';
import { createConfigStore } from '../config-store.ts';
import { createRoutinePlanStore } from '../sources/routine-plans.ts';
import { createRoutineStore } from '../sources/routines.ts';
import { event, fakeSources, fixedClock, silentLogger, testConfig } from '../testing.ts';
import { createDashboardService } from './dashboard.ts';

const sources = fakeSources({
  events: {
    alex: [event('passé', -2), event('ce-soir', 1), event('demain', 24), event('dans-10-jours', 240)],
    [FAMILY_ID]: [event('diner', 2)],
  },
  tasks: {
    alex: [
      { id: 't1', label: 'Poubelles', done: false },
      { id: 't2', label: 'Cantine', done: true },
    ],
  },
});
const config = createConfigStore(testConfig);
const service = createDashboardService({ config, sources, clock: fixedClock, logger: silentLogger() });

describe('home', () => {
  it('résume chaque membre puis la famille', async () => {
    const home = await service.home();
    expect(home.profiles.map((p) => p.ownerId)).toEqual(['alex', 'lea', FAMILY_ID]);
    expect(home.profiles[0]).toMatchObject({
      nextEvent: { id: 'ce-soir' },
      pendingTasks: 1,
      nextTasks: ['Poubelles'],
      unreadNotes: 1,
      routine: null,
    });
    expect(home.profiles[1]).toMatchObject({ nextEvent: null, pendingTasks: 0, nextTasks: [], unreadNotes: 0 });
    expect(home.familyHighlight?.id).toBe('diner');
  });
});

describe('configuration rechargée', () => {
  it('suit les membres de la configuration courante', async () => {
    const store = createConfigStore(testConfig);
    const svc = createDashboardService({ config: store, sources, clock: fixedClock, logger: silentLogger() });
    store.set(parseConfig({ members: [{ id: 'tom', name: 'Tom', color: '#d96aa7' }] }));

    expect((await svc.home()).profiles.map((p) => p.ownerId)).toEqual(['tom', FAMILY_ID]);
    expect(svc.hasOwner('alex')).toBe(false);
    expect(await svc.dashboard('alex')).toBeNull();
  });
});

describe('dashboard', () => {
  it('sépare le prochain événement des suivants, sur 7 jours', async () => {
    const data = await service.dashboard('alex');
    expect(data?.nextEvent?.id).toBe('ce-soir');
    expect(data?.upcoming.map((e) => e.id)).toEqual(['demain']);
    expect(data?.tasks).toHaveLength(2);
  });

  it('existe pour la famille', async () => {
    expect((await service.dashboard(FAMILY_ID))?.nextEvent?.id).toBe('diner');
  });

  it('renvoie null pour un profil inconnu', async () => {
    expect(await service.dashboard('inconnu')).toBeNull();
  });
});

describe('setTaskDone', () => {
  it('met à jour une tâche existante', async () => {
    expect(await service.setTaskDone('alex', 't1', true)).toMatchObject({ id: 't1', done: true });
  });

  it('renvoie null pour un profil ou une tâche inconnus', async () => {
    expect(await service.setTaskDone('inconnu', 't1', true)).toBeNull();
    expect(await service.setTaskDone('alex', 'absente', true)).toBeNull();
  });
});

describe('météo', () => {
  it('est masquée (null) quand la source échoue, sans faire échouer l’écran', async () => {
    const logger = silentLogger();
    const broken = {
      ...sources,
      weather: {
        async current(): Promise<never> {
          throw new Error('réseau coupé');
        },
        async forecast(): Promise<never> {
          throw new Error('réseau coupé');
        },
      },
    };
    const svc = createDashboardService({ config, sources: broken, clock: fixedClock, logger });

    expect((await svc.home()).weather).toBeNull();
    expect((await svc.dashboard('alex'))?.weather).toBeNull();
    expect(await svc.weatherForecast()).toBeNull();
    expect(logger.errors[0]).toContain('réseau coupé');
  });
});

describe('emploi du temps', () => {
  const course = (id: string, day: number, hour: number) => ({
    id,
    subject: id,
    start: new Date(2026, 10, day, hour).toISOString(),
    end: new Date(2026, 10, day, hour + 1).toISOString(),
    cancelled: false,
  });
  const withSchool = fakeSources({
    events: { alex: [event('ce-soir', 1), event('dans-3-jours', 72)] },
    courses: { alex: [course('maths', 2, 9), course('anglais', 3, 8), course('apres-demain', 4, 8)] },
  });
  const svc = createDashboardService({ config, sources: withSchool, clock: fixedClock, logger: silentLogger() });

  it('sépare les cours d’aujourd’hui et de demain, et transmet tous les événements', async () => {
    const data = await svc.dashboard('alex');
    expect(data?.school?.today.map((c) => c.id)).toEqual(['maths']);
    expect(data?.school?.tomorrow.map((c) => c.id)).toEqual(['anglais']);
    expect(data?.events.map((e) => e.id)).toEqual(['ce-soir', 'dans-3-jours']);
  });

  it('donne au résumé de l’accueil le prochain cours non annulé qui n’a pas commencé', async () => {
    const sources = fakeSources({
      courses: {
        alex: [
          { ...course('en-cours', 2, 17), end: new Date(2026, 10, 2, 19).toISOString() },
          { ...course('annule', 3, 8), cancelled: true },
          course('anglais', 3, 9),
        ],
      },
    });
    const home = await createDashboardService({ config, sources, clock: fixedClock, logger: silentLogger() }).home();
    expect(home.profiles.find((p) => p.ownerId === 'alex')?.nextCourse?.id).toBe('anglais');
    expect(home.profiles.find((p) => p.ownerId === 'lea')?.nextCourse).toBeNull();
  });

  it('vaut null pour un profil sans emploi du temps ou si la source échoue', async () => {
    expect((await svc.dashboard('lea'))?.school).toBeNull();
    const logger = silentLogger();
    const broken = {
      ...withSchool,
      school: {
        async coursesFor(): Promise<never> {
          throw new Error('ÉcoleDirecte en panne');
        },
      },
    };
    const brokenSvc = createDashboardService({ config, sources: broken, clock: fixedClock, logger });
    expect((await brokenSvc.dashboard('alex'))?.school).toBeNull();
    expect(logger.errors[0]).toContain('ÉcoleDirecte en panne');
  });
});

describe('semaine', () => {
  it('donne, pour chaque profil, les événements et les cours du lundi au dimanche', async () => {
    const withSchool = fakeSources({
      events: { alex: [event('passé', -2), event('dimanche', 6 * 24 - 13), event('lundi-suivant', 7 * 24 - 13)] },
      courses: { alex: [{ id: 'maths', subject: 'Maths', start: new Date(2026, 10, 2, 9).toISOString(), end: new Date(2026, 10, 2, 10).toISOString(), cancelled: false }] },
    });
    const svc = createDashboardService({ config, sources: withSchool, clock: fixedClock, logger: silentLogger() });

    const week = await svc.week(0);
    expect(week.start).toBe(new Date(2026, 10, 2).toISOString());
    expect(week.owners.map((o) => o.ownerId)).toEqual(['alex', 'lea', FAMILY_ID]);
    const alex = week.owners[0];
    expect(alex.events.map((e) => e.id)).toEqual(['passé', 'dimanche']);
    expect(alex.courses?.map((c) => c.id)).toEqual(['maths']);
    expect(week.owners[1].courses).toBeNull();

    const next = await svc.week(1);
    expect(next.start).toBe(new Date(2026, 10, 9).toISOString());
    expect(next.owners[0].events.map((e) => e.id)).toEqual(['lundi-suivant']);
    expect(next.owners[0].courses).toEqual([]);
  });
});

describe('routines', () => {
  const by = { ownerId: 'lea', via: 'tablet' as const };
  const windows = { morning: { from: '05:00', to: '11:00' }, evening: { from: '17:00', to: '23:00' } };
  const step = (id: string, label = id, days: number[] | null = null) => ({ id, label, days });

  function routineSetup() {
    const store = createConfigStore(
      parseConfig({
        members: [
          { id: 'alex', name: 'Alex', color: '#5b8def', parent: true },
          { id: 'lea', name: 'Léa', color: '#4caf7d' },
        ],
      }),
    );
    const dir = mkdtempSync(join(tmpdir(), 'homehub-svc-'));
    const routines = createRoutineStore({ path: join(dir, 'routines.json'), clock: fixedClock });
    const plans = createRoutinePlanStore({ path: join(dir, 'plans.json'), clock: fixedClock, config: store });
    const svc = createDashboardService({ config: store, sources, clock: fixedClock, logger: silentLogger(), routines, plans });
    return { svc, plans };
  }

  it("routine du moment (18 h : le soir), cochée par étape, avancement sur l'accueil", async () => {
    const { svc, plans } = routineSetup();
    expect((await svc.dashboard('lea'))?.routine).toBeNull(); // rien de réglé
    await plans.save(
      {
        members: {
          lea: { morning: [step('Dents')], evening: [step('Pyjama'), step('Dents'), step('Cartable'), step('Piscine', 'Piscine', [0, 3, 6])] },
        },
        windows,
      },
      by,
    );

    expect((await svc.dashboard('alex'))?.routine).toBeNull(); // pas de routine
    expect((await svc.dashboard('lea'))?.routine).toEqual({
      period: 'evening',
      items: [
        { id: 'evening-0', label: 'Pyjama', done: false },
        { id: 'evening-1', label: 'Dents', done: false },
        { id: 'evening-2', label: 'Cartable', done: false },
      ],
      streak: 0,
    });
    expect(await svc.setRoutineDone('lea', 'evening-1', true, by)).toEqual({ id: 'evening-1', label: 'Dents', done: true });
    expect(await svc.setRoutineDone('lea', 'evening-9', true, by)).toBeNull();
    expect(await svc.setRoutineDone('lea', 'nuit-0', true, by)).toBeNull();
    expect(await svc.setRoutineDone('lea', 'evening-3', true, by)).toBeNull(); // Piscine : pas le lundi
    expect((await svc.dashboard('lea'))?.routine?.items[1].done).toBe(true);
    expect((await svc.home()).profiles[1].routine).toEqual({ period: 'evening', done: 1, total: 3 });

    await svc.setRoutineDone('lea', 'evening-0', true, by);
    await svc.setRoutineDone('lea', 'evening-2', true, by);
    expect((await svc.dashboard('lea'))?.routine?.streak).toBe(1);
  });

  it('une étape renommée ou déplacée garde ses cases cochées ; heures modifiées', async () => {
    const { svc, plans } = routineSetup();
    await plans.save({ members: { lea: { morning: [], evening: [step('p', 'Pyjama'), step('d', 'Dents')] } }, windows }, by);
    await svc.setRoutineDone('lea', 'evening-1', true, by); // Dents

    await plans.save(
      { members: { lea: { morning: [], evening: [step('n', 'Douche'), step('d', 'Se brosser les dents'), step('p', 'Pyjama')] } }, windows },
      by,
    );
    expect((await svc.dashboard('lea'))?.routine?.items).toEqual([
      { id: 'evening-0', label: 'Douche', done: false },
      { id: 'evening-1', label: 'Se brosser les dents', done: true },
      { id: 'evening-2', label: 'Pyjama', done: false },
    ]);
    await plans.save({ members: {}, windows: { ...windows, evening: { from: '19:00', to: '23:00' } } }, by);
    expect((await svc.dashboard('lea'))?.routine).toBeNull(); // 18 h : plus l'heure du soir
  });
});
