// Tests des réponses rapides des télés (fonction 10) : seules les télés qui ont reçu le message répondent, une
// réponse par télé (la dernière fait foi), l'expéditeur seul les lit, attente longue réveillée par une réponse, fin
// au bout de REPLY_TTL_MS.
import { describe, expect, it } from 'vitest';
import { quickRepliesText } from '../../shared/screen.ts';
import { NOW } from '../testing.ts';
import { createScreenReplies, REPLY_CLOSED, REPLY_MAX, REPLY_NOT_YOURS, REPLY_TTL_MS, REPLY_UNKNOWN, replyAuthor } from './screen-replies.ts';

const SALON = { id: 'salon', name: 'Télé du salon' };
const CHAMBRE = { id: 'chambre', name: 'Télé de la chambre' };
const ALEX = replyAuthor({ ownerId: 'alex', via: 'phone' });

function setup(waitMs = 20) {
  let now = NOW.getTime();
  const replies = createScreenReplies({ clock: () => new Date(now), waitMs });
  return { replies, advance: (ms: number) => (now += ms) };
}

describe('réponses rapides des télés', () => {
  it('une réponse par télé, la dernière fait foi ; rev compte chaque réponse', async () => {
    const { replies } = setup();
    const id = replies.open(ALEX, [SALON, CHAMBRE]);
    replies.answer(SALON.id, id, 'ok');
    replies.answer(CHAMBRE.id, id, 'five');
    replies.answer(SALON.id, id, 'coming');
    const got = await replies.wait(id, ALEX, 0);
    expect(got.rev).toBe(3);
    expect(got.replies.map((r) => [r.screen, r.label])).toEqual([
      ['Télé de la chambre', '5 minutes'],
      ['Télé du salon', 'J’arrive'],
    ]);
  });

  it('l’attente longue se réveille dès qu’une télé répond', async () => {
    const { replies } = setup(5_000);
    const id = replies.open(ALEX, [SALON]);
    const waiting = replies.wait(id, ALEX, 0);
    setTimeout(() => replies.answer(SALON.id, id, 'coming'), 10);
    const started = performance.now();
    expect((await waiting).replies).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('sans réponse : liste vide au bout de l’attente', async () => {
    const { replies } = setup();
    const id = replies.open(ALEX, [SALON]);
    expect(await replies.wait(id, ALEX, 0)).toEqual({ replies: [], rev: 0, open: true });
  });

  it('autre expéditeur : refusé ; message inconnu ou télé qui ne l’a pas reçu : refusés', async () => {
    const { replies } = setup();
    const id = replies.open(ALEX, [SALON]);
    await expect(replies.wait(id, replyAuthor({ ownerId: 'sam', via: 'phone' }), 0)).rejects.toThrow(REPLY_NOT_YOURS);
    await expect(replies.wait('inconnu', ALEX, 0)).rejects.toThrow(REPLY_UNKNOWN);
    expect(() => replies.answer(CHAMBRE.id, id, 'ok')).toThrow(REPLY_UNKNOWN);
  });

  it('keep : seules les télés qui l’ont affiché répondent ; aucune, l’attente s’efface', async () => {
    const { replies } = setup();
    const id = replies.open(ALEX, [SALON, CHAMBRE]);
    replies.keep(id, [SALON.id]);
    expect(() => replies.answer(CHAMBRE.id, id, 'ok')).toThrow(REPLY_UNKNOWN);
    const gone = replies.open(ALEX, [SALON]);
    replies.keep(gone, []);
    await expect(replies.wait(gone, ALEX, 0)).rejects.toThrow(REPLY_UNKNOWN);
  });

  it('trop tard au bout de REPLY_TTL_MS : refusé, open passe à false, puis oublié', async () => {
    const { replies, advance } = setup();
    const id = replies.open(ALEX, [SALON]);
    advance(REPLY_TTL_MS);
    expect(() => replies.answer(SALON.id, id, 'ok')).toThrow(REPLY_CLOSED);
    expect(await replies.wait(id, ALEX, 0)).toEqual({ replies: [], rev: 0, open: false });
    replies.open(ALEX, [SALON]);
    await expect(replies.wait(id, ALEX, 0)).rejects.toThrow(REPLY_UNKNOWN);
  });

  it(`au plus ${REPLY_MAX} attentes gardées : les plus anciennes s’en vont`, async () => {
    const { replies } = setup();
    const first = replies.open(ALEX, [SALON]);
    for (let i = 0; i < REPLY_MAX; i++) replies.open(ALEX, [SALON]);
    await expect(replies.wait(first, ALEX, 0)).rejects.toThrow(REPLY_UNKNOWN);
  });
});

describe('texte des réponses au téléphone', () => {
  const at = NOW.toISOString();
  it('une télé : la dernière réponse ; plusieurs : chacune avec sa télé ; aucune : null', () => {
    expect(quickRepliesText([])).toBeNull();
    expect(quickRepliesText([{ reply: 'coming', label: 'J’arrive', screen: 'Télé du salon', at }])).toBe('Réponse : J’arrive');
    expect(
      quickRepliesText([
        { reply: 'coming', label: 'J’arrive', screen: 'Télé du salon', at },
        { reply: 'ok', label: 'OK', screen: 'Télé de la chambre', at },
      ]),
    ).toBe('Réponses : J’arrive (Télé du salon), OK (Télé de la chambre)');
  });
});
