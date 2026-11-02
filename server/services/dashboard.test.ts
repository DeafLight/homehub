import { describe, expect, it } from 'vitest';
import { FAMILY_ID } from '../../shared/types.ts';
import { event, fakeSources, fixedClock, testConfig } from '../testing.ts';
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
const service = createDashboardService({ config: testConfig, sources, clock: fixedClock });

describe('home', () => {
  it('résume chaque membre puis la famille', async () => {
    const home = await service.home();
    expect(home.profiles.map((p) => p.ownerId)).toEqual(['alex', 'lea', FAMILY_ID]);
    expect(home.profiles[0]).toMatchObject({ nextEvent: { id: 'ce-soir' }, pendingTasks: 1 });
    expect(home.profiles[1]).toMatchObject({ nextEvent: null, pendingTasks: 0 });
    expect(home.familyHighlight?.id).toBe('diner');
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
