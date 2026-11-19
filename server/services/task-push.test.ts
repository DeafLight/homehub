// Tests de la notification « Tâche en retard » : texte (tâche, famille, ouvre les tâches), le lendemain de l'échéance
// à partir de 8 h seulement, tâche cochée ou vieille ignorée, profil de la tâche ou parents pour la famille, une seule
// fois par tâche et par échéance, téléphone retiré ignoré, « Tâches en retard » coupé, abonnement périmé oublié.
import { describe, expect, it } from 'vitest';
import { FAMILY_ID, type ListTask, type PushPrefs } from '../../shared/types.ts';
import type { PushRecord } from '../sources/push.ts';
import { silentLogger } from '../testing.ts';
import { createTaskPush, lateTasks, taskMessage, taskRecipients } from './task-push.ts';
import type { PushMessage, PushResult } from './web-push.ts';

const MEMBERS = [
  { id: 'alex', parent: true },
  { id: 'sam', parent: true },
  { id: 'lea', parent: false },
  { id: 'tom', parent: false },
];
/** 19 novembre 2026, heure locale. */
const day = (hour: number, date = 19) => new Date(2026, 10, date, hour, 0);

const task = (id: string, ownerId: string, due: string | null = '2026-11-18', done = false): ListTask => ({
  id,
  label: `Ranger la chambre (${id})`,
  ownerId,
  due,
  repeat: null,
  done,
  addedBy: { ownerId: 'sam', via: 'phone' },
  addedAt: '2026-11-10T07:00:00.000Z',
});

const sub = (deviceId: string, ownerId: string, prefs: Partial<PushPrefs> = {}): PushRecord => ({
  deviceId,
  ownerId,
  endpoint: `https://push.exemple.test/${deviceId}`,
  keys: { p256dh: 'p', auth: 'a' },
  prefs: { trips: true, notes: true, timers: true, tasks: true, ...prefs },
});

function setup({
  tasks = [task('t1', 'lea')],
  subs: initial = [sub('tel-alex', 'alex'), sub('tel-sam', 'sam'), sub('tel-lea', 'lea'), sub('tel-tom', 'tom')],
  devices = [
    { id: 'tel-alex', ownerId: 'alex' },
    { id: 'tel-sam', ownerId: 'sam' },
    { id: 'tel-lea', ownerId: 'lea' },
    { id: 'tel-tom', ownerId: 'tom' },
  ],
  result = (_: PushRecord): PushResult => 'sent',
} = {}) {
  let subs = initial;
  let now = day(9);
  const marked = new Set<string>();
  const sent: { to: string; message: PushMessage }[] = [];
  const logger = silentLogger();
  const push = createTaskPush({
    lists: { lists: async () => ({ shopping: [], tasks, frequent: [] }) },
    store: {
      all: async () => subs,
      unsubscribe: async (id) => void (subs = subs.filter((s) => s.deviceId !== id)),
      markSent: async (key) => !marked.has(key) && Boolean(marked.add(key)),
    },
    devices: async () => devices,
    members: () => MEMBERS,
    send: async (s, message) => (sent.push({ to: s.deviceId, message }), result(s)),
    clock: () => now,
    logger,
  });
  return { push, sent, logger, marked, at: (d: Date) => void (now = d), subs: () => subs.map((s) => s.deviceId) };
}

describe('message, destinataires, tâches concernées', () => {
  it('« Tâche en retard » et le texte de la tâche, ouvre les tâches ; « … de la famille »', () => {
    expect(taskMessage(task('t1', 'lea'))).toEqual({ title: 'Tâche en retard', body: 'Ranger la chambre (t1)', tag: 'tache-t1', url: '/m/taches' });
    expect(taskMessage(task('t2', FAMILY_ID)).title).toBe('Tâche de la famille en retard');
  });

  it('le profil de la tâche ; la famille : les parents ; profil inconnu : personne', () => {
    expect([...taskRecipients(task('t1', 'tom'), MEMBERS)]).toEqual(['tom']);
    expect([...taskRecipients(task('t1', FAMILY_ID), MEMBERS)]).toEqual(['alex', 'sam']);
    expect([...taskRecipients(task('t1', 'ancien'), MEMBERS)]).toEqual([]);
  });

  it('en retard depuis ce matin seulement : pas cochée, échéance hier, à partir de 8 h', () => {
    const tasks = [task('hier', 'lea'), task('faite', 'lea', '2026-11-18', true), task('vieille', 'lea', '2026-11-10'), task('auj', 'lea', '2026-11-19'), task('sans', 'lea', null)];
    expect(lateTasks(tasks, day(7))).toEqual([]);
    expect(lateTasks(tasks, day(8)).map((t) => t.id)).toEqual(['hier']);
    expect(lateTasks(tasks, day(23)).map((t) => t.id)).toEqual(['hier']);
    // Changement de mois.
    expect(lateTasks([task('fin', 'lea', '2026-11-30')], new Date(2026, 11, 1, 9)).map((t) => t.id)).toEqual(['fin']);
  });
});

describe('envoi', () => {
  it('au téléphone du profil de la tâche seulement, avec son texte', async () => {
    const { push, sent } = setup();
    await push.tick();
    expect(sent.map((s) => `${s.to} ${s.message.body}`)).toEqual(['tel-lea Ranger la chambre (t1)']);
  });

  it('rien avant 8 h', async () => {
    const { push, sent, at } = setup();
    at(day(6));
    await push.tick();
    expect(sent).toEqual([]);
  });

  it('une seule fois par tâche et par échéance', async () => {
    const { push, sent, marked, at } = setup();
    await push.tick();
    at(day(15));
    await push.tick();
    expect(sent).toHaveLength(1);
    expect([...marked]).toEqual(['tache|t1|2026-11-18']);
  });

  it('tâche de la famille : les téléphones des parents', async () => {
    const { push, sent } = setup({ tasks: [task('t1', FAMILY_ID)] });
    await push.tick();
    expect(sent.map((s) => s.to)).toEqual(['tel-alex', 'tel-sam']);
  });

  it('téléphone retiré (ou passé à un autre profil) : ignoré', async () => {
    const { push, sent } = setup({ devices: [{ id: 'tel-lea', ownerId: 'tom' }] });
    await push.tick();
    expect(sent).toEqual([]);
  });

  it('« Tâches en retard » coupé sur un téléphone : rien pour lui, les autres le reçoivent', async () => {
    const { push, sent } = setup({ tasks: [task('t1', FAMILY_ID)], subs: [sub('tel-alex', 'alex', { tasks: false }), sub('tel-sam', 'sam')] });
    await push.tick();
    expect(sent.map((s) => s.to)).toEqual(['tel-sam']);
  });

  it('abonnement périmé : oublié ; échec du service : au journal', async () => {
    const { push, subs, logger } = setup({ tasks: [task('t1', FAMILY_ID)], result: (s) => (s.deviceId === 'tel-alex' ? 'gone' : 'failed') });
    await push.tick();
    expect(subs()).toEqual(['tel-sam', 'tel-lea', 'tel-tom']);
    expect(logger.errors).toHaveLength(1);
  });
});
