import { mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Author } from '../../shared/types.ts';
import { NOW } from '../testing.ts';
import { createListsStore, listsTaskSource, nextDue } from './lists.ts';

const tablet: Author = { ownerId: null, via: 'tablet' };
const phone: Author = { ownerId: 'lea', via: 'phone' };

function setup() {
  let now = NOW;
  const path = join(mkdtempSync(join(tmpdir(), 'homehub-lists-')), 'lists.json');
  const store = createListsStore({ path, clock: () => now });
  return { store, path, setNow: (date: Date) => (now = date) };
}

describe('listes', () => {
  it('courses : ajout sans doublon, panier, vider, articles fréquents', async () => {
    const { store } = setup();
    const lait = await store.addShopping('Lait', phone);
    expect(await store.addShopping('lait', tablet)).toEqual(lait);
    const pain = await store.addShopping('Pain', tablet);
    await store.setShoppingDone(lait.id, true, tablet);

    let lists = await store.lists();
    expect(lists.shopping.map((s) => [s.label, s.done])).toEqual([
      ['Pain', false],
      ['Lait', true],
    ]);
    expect(lists.shopping[1].doneBy).toEqual(tablet);
    // Déjà sur la liste, même dans le panier : pas proposé.
    expect(lists.frequent).toEqual([]);

    await store.clearShopping();
    await store.removeShopping(pain.id);
    await store.addShopping('Lait', phone);
    lists = await store.lists();
    expect(lists.shopping.map((s) => s.label)).toEqual(['Lait']);
    expect(lists.frequent).toEqual(['Pain']);
  });

  it('tâches : par échéance, faites aujourd’hui visibles jusqu’à minuit', async () => {
    const { store, setNow } = setup();
    await store.addTask({ label: 'Sans date', ownerId: 'alex', due: null, repeat: null }, tablet);
    await store.addTask({ label: 'Vendredi', ownerId: 'alex', due: '2026-11-06', repeat: null }, tablet);
    const today = await store.addTask({ label: 'Aujourd’hui', ownerId: 'lea', due: '2026-11-02', repeat: null }, phone);
    await store.setTaskDone(today.id, true, phone);

    expect((await store.lists()).tasks.map((t) => [t.label, t.done])).toEqual([
      ['Vendredi', false],
      ['Sans date', false],
      ['Aujourd’hui', true],
    ]);
    setNow(new Date(2026, 10, 3, 8, 0));
    expect((await store.lists()).tasks.map((t) => t.label)).toEqual(['Vendredi', 'Sans date']);
  });

  it('tâche qui revient : la suivante est créée, et retirée si on décoche', async () => {
    const { store } = setup();
    const bins = await store.addTask(
      { label: 'Poubelles', ownerId: 'tom', due: '2026-10-27', repeat: { every: 1, unit: 'week' } },
      tablet,
    );
    await store.setTaskDone(bins.id, true, phone);
    let tasks = (await store.lists()).tasks;
    expect(tasks.map((t) => [t.due, t.done])).toEqual([
      ['2026-11-03', false],
      ['2026-10-27', true],
    ]);
    expect(tasks[0].repeat).toEqual({ every: 1, unit: 'week' });

    await store.setTaskDone(bins.id, false, phone);
    tasks = (await store.lists()).tasks;
    expect(tasks.map((t) => [t.due, t.done])).toEqual([['2026-10-27', false]]);
  });

  it('prochaine échéance : la première après aujourd’hui', () => {
    expect(nextDue('2026-11-02', { every: 1, unit: 'week' }, '2026-11-02')).toBe('2026-11-09');
    expect(nextDue('2026-10-20', { every: 1, unit: 'week' }, '2026-11-02')).toBe('2026-11-03');
    expect(nextDue(null, { every: 3, unit: 'day' }, '2026-11-02')).toBe('2026-11-05');
    expect(nextDue('2026-10-31', { every: 1, unit: 'day' }, '2026-11-02')).toBe('2026-11-03');
  });

  it('enregistrées sur le disque, relues au démarrage ; fichier illisible : erreur, jamais écrasé', async () => {
    const { store, path } = setup();
    await store.addShopping('Café', tablet);
    const again = createListsStore({ path, clock: () => NOW });
    expect((await again.lists()).shopping.map((s) => s.label)).toEqual(['Café']);

    await writeFile(path, '{ "version": 2 }');
    const broken = createListsStore({ path, clock: () => NOW });
    await expect(broken.lists()).rejects.toThrow(/illisible/);
    await expect(broken.addShopping('Thé', tablet)).rejects.toThrow(/illisible/);
    expect(await readFile(path, 'utf8')).toBe('{ "version": 2 }');
  });

  it('vues par les dashboards : tâches du membre, courses pour la famille', async () => {
    const { store } = setup();
    await store.addShopping('Pommes', tablet);
    const task = await store.addTask({ label: 'Devoirs', ownerId: 'lea', due: null, repeat: null }, tablet);
    const source = listsTaskSource(store, 'famille');
    expect(await source.tasksFor('famille')).toMatchObject([{ label: 'Pommes', done: false }]);
    expect(await source.tasksFor('lea')).toEqual([{ id: task.id, label: 'Devoirs', done: false }]);
    expect(await source.setDone('lea', task.id, true)).toEqual({ id: task.id, label: 'Devoirs', done: true });
    // Depuis le dashboard d'un autre profil : refusée (le droit d'écrire a été vérifié sur ce profil-là).
    expect(await source.setDone('tom', task.id, false)).toBeNull();
    expect(await source.tasksFor('lea')).toMatchObject([{ done: true }]);
  });
});
