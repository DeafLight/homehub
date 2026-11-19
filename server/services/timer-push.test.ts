// Tests de la notification « Minuteur » : texte (nom, durée, ouvre l'accueil), téléphones de qui l'a lancé, parents
// sans auteur connu, rien avant la fin ni pour un minuteur arrêté, une seule fois (même après un redémarrage),
// téléphone retiré ignoré, « Minuteurs » coupé, abonnement périmé oublié, échec au journal.
import { describe, expect, it } from 'vitest';
import type { PushPrefs, Timer } from '../../shared/types.ts';
import type { PushRecord } from '../sources/push.ts';
import { silentLogger } from '../testing.ts';
import { createTimerPush, timerMessage, timerRecipients } from './timer-push.ts';
import type { PushMessage, PushResult } from './web-push.ts';

const MEMBERS = [
  { id: 'alex', parent: true },
  { id: 'sam', parent: true },
  { id: 'lea', parent: false },
  { id: 'tom', parent: false },
];
const START = Date.parse('2026-11-19T17:00:00.000Z');

const timer = (id: string, ownerId: string | null, seconds = 600, label = 'Pâtes'): Timer => ({
  id,
  label,
  durationSeconds: seconds,
  startedAt: new Date(START).toISOString(),
  endsAt: new Date(START + seconds * 1000).toISOString(),
  startedBy: { ownerId, via: 'tablet' },
});

const sub = (deviceId: string, ownerId: string, prefs: Partial<PushPrefs> = {}): PushRecord => ({
  deviceId,
  ownerId,
  endpoint: `https://push.exemple.test/${deviceId}`,
  keys: { p256dh: 'p', auth: 'a' },
  prefs: { trips: true, notes: true, timers: true, tasks: true, ...prefs },
});

function setup({
  timers = [timer('t1', 'lea')],
  subs: initial = [sub('tel-alex', 'alex'), sub('tel-sam', 'sam'), sub('tel-lea', 'lea'), sub('tel-tom', 'tom')],
  devices = [
    { id: 'tel-alex', ownerId: 'alex' },
    { id: 'tel-sam', ownerId: 'sam' },
    { id: 'tel-lea', ownerId: 'lea' },
    { id: 'tel-tom', ownerId: 'tom' },
  ],
  result = (_: PushRecord): PushResult => 'sent',
  marked = new Set<string>(),
} = {}) {
  let subs = initial;
  let list = timers;
  let now = START;
  const sent: { to: string; message: PushMessage }[] = [];
  const logger = silentLogger();
  const make = () =>
    createTimerPush({
      timers: { list: () => list },
      store: {
        all: async () => subs,
        unsubscribe: async (id) => void (subs = subs.filter((s) => s.deviceId !== id)),
        markSent: async (key) => !marked.has(key) && Boolean(marked.add(key)),
      },
      devices: async () => devices,
      members: () => MEMBERS,
      send: async (s, message) => (sent.push({ to: s.deviceId, message }), result(s)),
      clock: () => new Date(now),
      logger,
    });
  return {
    push: make(),
    /** Nouveau processus (redémarrage) sur le même push.json. */
    restart: make,
    sent,
    logger,
    marked,
    at: (ms: number) => void (now = START + ms),
    setTimers: (t: Timer[]) => void (list = t),
    subs: () => subs.map((s) => s.deviceId),
  };
}

describe('message et destinataires', () => {
  it('le nom du minuteur, « C’est l’heure ! (10 min) », ouvre l’accueil ; « Minuteur » sans nom', () => {
    expect(timerMessage(timer('t1', 'lea'))).toEqual({ title: 'Pâtes', body: 'C’est l’heure ! (10 min)', tag: 'minuteur-t1', url: '/m' });
    expect(timerMessage(timer('t2', 'lea', 30, '')).title).toBe('Minuteur');
  });

  it('qui l’a lancé ; sans auteur connu, les parents', () => {
    expect([...timerRecipients(timer('t1', 'tom'), MEMBERS)]).toEqual(['tom']);
    expect([...timerRecipients(timer('t1', null), MEMBERS)]).toEqual(['alex', 'sam']);
    expect([...timerRecipients(timer('t1', 'ancien'), MEMBERS)]).toEqual(['alex', 'sam']);
  });
});

describe('envoi', () => {
  it('rien avant la fin ; à la fin, au téléphone de qui l’a lancé seulement', async () => {
    const { push, sent, at } = setup();
    at(599_000);
    await push.tick();
    expect(sent).toEqual([]);
    at(600_000);
    await push.tick();
    expect(sent.map((s) => `${s.to} ${s.message.title}`)).toEqual(['tel-lea Pâtes']);
  });

  it('une seule fois, même après un redémarrage', async () => {
    const { push, restart, sent, at } = setup();
    at(601_000);
    await push.tick();
    await push.tick();
    await restart().tick();
    expect(sent).toHaveLength(1);
  });

  it('minuteur arrêté avant la fin : rien', async () => {
    const { push, sent, at, setTimers } = setup();
    setTimers([]);
    at(700_000);
    await push.tick();
    expect(sent).toEqual([]);
  });

  it('sans auteur connu : les téléphones des parents', async () => {
    const { push, sent, at } = setup({ timers: [timer('t1', null)] });
    at(600_000);
    await push.tick();
    expect(sent.map((s) => s.to)).toEqual(['tel-alex', 'tel-sam']);
  });

  it('téléphone retiré (ou passé à un autre profil) : ignoré', async () => {
    const { push, sent, at } = setup({ devices: [{ id: 'tel-lea', ownerId: 'tom' }] });
    at(600_000);
    await push.tick();
    expect(sent).toEqual([]);
  });

  it('« Minuteurs » coupé sur un téléphone : rien pour lui, les autres le reçoivent', async () => {
    const { push, sent, at } = setup({ timers: [timer('t1', null)], subs: [sub('tel-alex', 'alex', { timers: false }), sub('tel-sam', 'sam')] });
    at(600_000);
    await push.tick();
    expect(sent.map((s) => s.to)).toEqual(['tel-sam']);
  });

  it('abonnement périmé : oublié ; échec du service : au journal', async () => {
    const { push, subs, logger, at } = setup({ timers: [timer('t1', null)], result: (s) => (s.deviceId === 'tel-alex' ? 'gone' : 'failed') });
    at(600_000);
    await push.tick();
    expect(subs()).toEqual(['tel-sam', 'tel-lea', 'tel-tom']);
    expect(logger.errors).toHaveLength(1);
  });
});
