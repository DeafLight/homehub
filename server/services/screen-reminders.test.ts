// Tests de la planification des rappels sur la télé : envoi à l'heure aux seules télés allumées, une fois par jour même
// après un redémarrage, rattrapage quand une télé s'allume, rappel coupé, rien à rappeler, « Essayer » ; textes construits
// d'après les routines du soir et les mots pas encore vus (sans leur texte).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RemotePower, ScreenEventBody, ScreenReport } from '../../shared/screen.ts';
import type { Note, Routine } from '../../shared/types.ts';
import { HttpError } from '../http.ts';
import { createScreenReminderStore } from '../sources/screen-reminders.ts';
import { FAMILY_LABEL, NOTHING_TO_REMIND, createScreenReminders, reminderBuilders } from './screen-reminders.ts';

const day = (h: number, m: number, d = 2) => new Date(2026, 10, d, h, m);
const quiet = { log: () => {}, error: () => {} };

function setup({ power = { salon: 'on', chambre: 'standby' } as Record<string, RemotePower>, routine = 'Routine du soir' as string | null } = {}) {
  let now = day(19, 0);
  const path = join(mkdtempSync(join(tmpdir(), 'homehub-reminders-')), 'screen-reminders.json');
  const store = createScreenReminderStore({ path });
  const sent: { id: string; event: ScreenEventBody }[] = [];
  const hub = {
    power: (id: string) => power[id] ?? 'offline',
    send: async (id: string, event: ScreenEventBody): Promise<ScreenReport> => {
      sent.push({ id, event });
      return { ok: true };
    },
  };
  const reminders = createScreenReminders({
    store,
    hub,
    screenIds: async () => Object.keys(power),
    builders: {
      'evening-routine': async () => (routine ? { title: routine, subtitle: 'Léa : encore 2 étapes' } : null),
      notes: async () => null,
    },
    clock: () => now,
    logger: quiet,
  });
  return { reminders, store, sent, power, path, setNow: (d: Date) => (now = d) };
}

describe('planification', () => {
  it('à l’heure, le bandeau part aux seules télés allumées, une fois par jour', async () => {
    const { reminders, sent, setNow } = setup();
    await reminders.tick();
    expect(sent).toEqual([]);
    setNow(day(19, 30));
    await reminders.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: 'salon', event: { kind: 'reminder', reminder: 'evening-routine', title: 'Routine du soir', subtitle: 'Léa : encore 2 étapes', seconds: 20 } });
    setNow(day(19, 40));
    await reminders.tick();
    expect(sent).toHaveLength(1);
    // Le lendemain, de nouveau.
    setNow(day(19, 31, 3));
    await reminders.tick();
    expect(sent).toHaveLength(2);
  });

  it('une fois par jour même après un redémarrage du serveur (jour d’envoi enregistré)', async () => {
    const first = setup();
    first.setNow(day(19, 30));
    await first.reminders.tick();
    const again = createScreenReminders({
      store: createScreenReminderStore({ path: first.path }),
      hub: { power: () => 'on', send: async (id, event) => (first.sent.push({ id, event }), { ok: true }) },
      screenIds: async () => ['salon'],
      builders: { 'evening-routine': async () => ({ title: 'Routine du soir', subtitle: '…' }), notes: async () => null },
      clock: () => day(19, 35),
      logger: quiet,
    });
    await again.tick();
    expect(first.sent).toHaveLength(1);
  });

  it('aucune télé allumée : rattrapé quand une s’allume, pas après le rattrapage', async () => {
    const { reminders, sent, power, setNow } = setup({ power: { salon: 'standby' } });
    setNow(day(19, 30));
    await reminders.tick();
    expect(sent).toEqual([]);
    power.salon = 'on';
    setNow(day(19, 45));
    await reminders.tick();
    expect(sent).toHaveLength(1);

    const late = setup({ power: { salon: 'standby' } });
    late.setNow(day(19, 30));
    await late.reminders.tick();
    late.power.salon = 'on';
    late.setNow(day(20, 5));
    await late.reminders.tick();
    expect(late.sent).toEqual([]);
  });

  it('rappel coupé ou heure changée', async () => {
    const { reminders, store, sent, setNow } = setup();
    await store.save({ reminders: [{ kind: 'evening-routine', enabled: false, time: '19:30' }] }, { ownerId: 'alex', via: 'tablet' }, day(18, 0));
    setNow(day(19, 30));
    await reminders.tick();
    expect(sent).toEqual([]);
    await store.save({ reminders: [{ kind: 'evening-routine', enabled: true, time: '20:15' }] }, { ownerId: 'alex', via: 'tablet' }, day(19, 31));
    await reminders.tick();
    expect(sent).toEqual([]);
    setNow(day(20, 15));
    await reminders.tick();
    expect(sent).toHaveLength(1);
  });

  it('rien à rappeler : pas de bandeau, ni plus tard dans la soirée', async () => {
    const { reminders, sent, setNow } = setup({ routine: null });
    setNow(day(19, 30));
    await reminders.tick();
    setNow(day(19, 35));
    await reminders.tick();
    expect(sent).toEqual([]);
  });
});

describe('Essayer', () => {
  it('envoie tout de suite, quelle que soit l’heure', async () => {
    const { reminders, sent } = setup();
    expect(await reminders.sendNow('evening-routine')).toEqual({ title: 'Routine du soir', subtitle: 'Léa : encore 2 étapes', screens: 1 });
    expect(sent).toHaveLength(1);
  });

  it('409 sans rien à rappeler, 503 sans télé allumée', async () => {
    await expect(setup().reminders.sendNow('notes')).rejects.toMatchObject({ status: 409, message: NOTHING_TO_REMIND });
    await expect(setup({ power: { salon: 'offline' } }).reminders.sendNow('evening-routine')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('textes des rappels', () => {
  const members = [
    { id: 'alex', name: 'Alex' },
    { id: 'lea', name: 'Léa' },
    { id: 'tom', name: 'Tom' },
  ];
  const routine = (period: 'morning' | 'evening', done: boolean[]): Routine => ({
    period,
    streak: 0,
    items: done.map((d, i) => ({ id: `${period}-${i}`, label: `Étape ${i}`, done: d })),
  });
  const note = (to: string): Note => ({ id: to, text: 'Texte privé', to, from: { ownerId: 'alex', via: 'phone' }, at: '2026-11-02T10:00:00.000Z' });

  it('routine du soir : étapes pas cochées de chacun', async () => {
    const builders = reminderBuilders({
      household: { members: () => members as never },
      routineOf: async (id) => ({ alex: null, lea: routine('evening', [true, false, false]), tom: routine('evening', [true]) })[id] ?? null,
      notes: { unseenFor: async () => [] },
    });
    expect(await builders['evening-routine']()).toEqual({ title: 'Routine du soir', subtitle: 'Léa : encore 2 étapes' });
  });

  it('routine du matin à l’heure du rappel (plages réglées autrement) : rien', async () => {
    const builders = reminderBuilders({
      household: { members: () => members as never },
      routineOf: async () => routine('morning', [false]),
      notes: { unseenFor: async () => [] },
    });
    expect(await builders['evening-routine']()).toBeNull();
  });

  it('mots : un nombre par destinataire, famille comprise, jamais le texte', async () => {
    const unseen: Record<string, Note[]> = { tom: [note('tom')], famille: [note('famille'), note('famille')] };
    const builders = reminderBuilders({
      household: { members: () => members as never },
      routineOf: async () => null,
      notes: { unseenFor: async (id) => unseen[id] ?? [] },
    });
    const text = await builders.notes();
    expect(text).toEqual({ title: 'Mots à lire sur la tablette', subtitle: `Tom : 1 mot · ${FAMILY_LABEL} : 2 mots` });
    expect(JSON.stringify(text)).not.toContain('Texte privé');
  });
});
