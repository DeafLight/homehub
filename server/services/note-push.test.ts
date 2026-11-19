// Tests de la notification « Nouveau mot » : texte (auteur, famille, texte du mot, ouvre les mots), destinataire seul,
// toute la famille sans l'auteur, téléphone retiré ignoré, « Nouveaux mots » coupé, abonnement périmé oublié, erreur
// d'envoi au journal sans faire échouer la route.
import { describe, expect, it } from 'vitest';
import { FAMILY_ID, type Note, type PushPrefs } from '../../shared/types.ts';
import type { PushRecord } from '../sources/push.ts';
import { silentLogger } from '../testing.ts';
import { createNotePush, noteMessage } from './note-push.ts';
import type { PushMessage, PushResult } from './web-push.ts';

const NAMES: Record<string, string> = { alex: 'Alex', sam: 'Sam', lea: 'Léa', tom: 'Tom' };

const note = (to: string, from = 'sam', text = 'Pense à sortir le chien'): Note => ({
  id: 'mot-1',
  text,
  to,
  from: { ownerId: from, via: 'phone' },
  at: '2026-11-19T07:00:00.000Z',
});

const sub = (deviceId: string, ownerId: string, prefs: Partial<PushPrefs> = {}): PushRecord => ({
  deviceId,
  ownerId,
  endpoint: `https://push.exemple.test/${deviceId}`,
  keys: { p256dh: 'p', auth: 'a' },
  prefs: { trips: true, notes: true, timers: true, tasks: true, ...prefs },
});

function setup({
  subs: initial = [sub('tel-alex', 'alex'), sub('tel-sam', 'sam'), sub('tel-lea', 'lea'), sub('tel-tom', 'tom')],
  devices = [
    { id: 'tel-alex', ownerId: 'alex' },
    { id: 'tel-sam', ownerId: 'sam' },
    { id: 'tel-lea', ownerId: 'lea' },
    { id: 'tel-tom', ownerId: 'tom' },
  ],
  result = (_: PushRecord): PushResult | Promise<PushResult> => 'sent',
} = {}) {
  let subs = initial;
  const sent: { to: string; message: PushMessage }[] = [];
  const logger = silentLogger();
  const push = createNotePush({
    store: { all: async () => subs, unsubscribe: async (id) => void (subs = subs.filter((s) => s.deviceId !== id)) },
    devices: async () => devices,
    nameOf: (id) => NAMES[id] ?? id,
    send: async (s, message) => (sent.push({ to: s.deviceId, message }), result(s)),
    logger,
  });
  return { push, sent, logger, subs: () => subs.map((s) => s.deviceId) };
}

describe('message', () => {
  it('« Mot de Sam », le texte du mot, ouvre les mots ; « pour toute la famille » si besoin', () => {
    expect(noteMessage(note('lea'), 'Sam')).toEqual({ title: 'Mot de Sam', body: 'Pense à sortir le chien', tag: 'mot-mot-1', url: '/m/mots' });
    expect(noteMessage(note(FAMILY_ID), 'Sam').title).toBe('Mot de Sam pour toute la famille');
  });
});

describe('envoi', () => {
  it('au téléphone du destinataire seulement', async () => {
    const { push, sent } = setup();
    await push.notify(note('lea'));
    expect(sent.map((s) => `${s.to} ${s.message.title}`)).toEqual(['tel-lea Mot de Sam']);
  });

  it('toute la famille : tous les membres abonnés sauf l’auteur', async () => {
    const { push, sent } = setup();
    await push.notify(note(FAMILY_ID));
    expect(sent.map((s) => s.to)).toEqual(['tel-alex', 'tel-lea', 'tel-tom']);
    expect(sent[0]?.message.title).toBe('Mot de Sam pour toute la famille');
  });

  it('téléphone retiré (ou passé à un autre profil) : ignoré', async () => {
    const { push, sent } = setup({ devices: [{ id: 'tel-lea', ownerId: 'tom' }] });
    await push.notify(note('lea'));
    expect(sent).toEqual([]);
  });

  it('« Nouveaux mots » coupé sur un téléphone : rien pour lui, les autres le reçoivent', async () => {
    const { push, sent } = setup({ subs: [sub('tel-lea', 'lea', { notes: false }), sub('tel-tom', 'tom')] });
    await push.notify(note(FAMILY_ID));
    expect(sent.map((s) => s.to)).toEqual(['tel-tom']);
  });

  it('abonnement périmé : oublié ; échec du service : au journal', async () => {
    const { push, subs, logger } = setup({ result: (s) => (s.deviceId === 'tel-lea' ? 'gone' : 'failed') });
    await push.notify(note(FAMILY_ID));
    expect(subs()).toEqual(['tel-alex', 'tel-sam', 'tel-tom']);
    expect(logger.errors).toHaveLength(2);
  });

  it('feu et oubli : une erreur ne remonte pas, elle va au journal', async () => {
    const { push, logger } = setup({ result: () => Promise.reject(new Error('réseau coupé')) });
    push.announce(note('lea'));
    await new Promise((r) => setTimeout(r, 0));
    expect(logger.errors).toEqual(['Notification « Nouveau mot » : réseau coupé']);
  });
});
