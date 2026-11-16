// Tests du suivi des réponses rapides au téléphone (tv-replies.ts) : réponses transmises, `after` qui avance, fin quand
// la télé ne peut plus répondre, abandon sur un refus, nouvel essai après une coupure, arrêt demandé.
import { describe, expect, it, vi } from 'vitest';
import type { ScreenReplies, ScreenReply } from '../../../shared/screen.ts';
import { ApiError } from './api.ts';
import { watchReplies } from './tv-replies.ts';

const coming: ScreenReply = { reply: 'coming', label: 'J’arrive', screen: 'Télé du salon', at: '2026-11-16T18:00:00.000Z' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeApi(answers: (ScreenReplies | Error)[]) {
  const calls: number[] = [];
  const api = {
    tvReplies: vi.fn(async (_id: string, after: number) => {
      calls.push(after);
      const next = answers.shift();
      if (!next) return new Promise<ScreenReplies>(() => {});
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  return { api, calls };
}

describe('suivi des réponses rapides', () => {
  it('transmet les nouvelles réponses, avance after, s’arrête quand la télé ne peut plus répondre', async () => {
    const { api, calls } = fakeApi([
      { replies: [], rev: 0, open: true },
      { replies: [coming], rev: 1, open: true },
      { replies: [coming], rev: 1, open: false },
    ]);
    const seen: ScreenReply[][] = [];
    watchReplies({ api, replyId: 'r1', onReplies: (r) => seen.push(r) });
    for (let i = 0; i < 5; i++) await tick();
    expect(seen).toEqual([[coming]]);
    expect(calls).toEqual([0, 0, 1]);
  });

  it('refus du serveur (message oublié) : plus rien à attendre', async () => {
    const { api, calls } = fakeApi([new ApiError(404, 'Message inconnu ou trop ancien'), { replies: [coming], rev: 1, open: true }]);
    watchReplies({ api, replyId: 'r1', onReplies: () => {} });
    for (let i = 0; i < 5; i++) await tick();
    expect(calls).toEqual([0]);
  });

  it('coupure réseau : nouvel essai après une pause', async () => {
    const { api, calls } = fakeApi([new TypeError('Failed to fetch'), { replies: [coming], rev: 1, open: false }]);
    const seen: ScreenReply[][] = [];
    watchReplies({ api, replyId: 'r1', onReplies: (r) => seen.push(r), retryMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([0, 0]);
    expect(seen).toEqual([[coming]]);
  });

  it('arrêt demandé : la réponse qui arrive ensuite n’est pas transmise', async () => {
    let resolve!: (r: ScreenReplies) => void;
    const api = { tvReplies: () => new Promise<ScreenReplies>((r) => (resolve = r)) };
    const seen: ScreenReply[][] = [];
    const stop = watchReplies({ api, replyId: 'r1', onReplies: (r) => seen.push(r) });
    stop();
    resolve({ replies: [coming], rev: 1, open: true });
    await tick();
    expect(seen).toEqual([]);
  });
});
