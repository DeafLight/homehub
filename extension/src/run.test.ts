// Tests du déroulé d'un remplissage : décisions sur la page ouverte (fiche attendue, déjà au panier, indisponible,
// captcha, page inattendue, autre produit, bouton absent), passage à la ligne suivante, arrêt (règle d'arrêt ou la
// personne), reprise, compte rendu relu par le serveur.
import { describe, expect, it } from 'vitest';
import { CART_KIND, type DriveCart, REPORT_KIND } from '../../shared/drive-cart.ts';
import { afterLine, decide, limitRun, lineStatus, lineUrl, newRun, type Page, progress, runIdIn, startRun, stopRun, toReport } from './run.ts';

const NOW = new Date('2026-11-12T10:00:00Z');
const url = (id: string) => `https://www.coursesu.com/p/x/${id}.html`;
const cart: DriveCart = {
  kind: CART_KIND,
  version: 1,
  enseigne: 'coursesu',
  store: 'Super U Exemple',
  lines: [
    { itemId: 'a', label: 'Gruyère', id: '9990012', name: 'Gruyère râpé, 200g', url: url('9990012'), count: 2 },
    { itemId: 'b', label: 'Lessive', id: '9990014', name: 'Lessive Clair, 1,5L', url: url('9990014'), count: 1 },
  ],
};
const product = (over: Partial<Extract<Page, { kind: 'product' }>> = {}): Page => ({ kind: 'product', id: '9990012', ean: null, price: null, inCart: 0, canAdd: true, unavailable: false, ...over });
const running = () => startRun(newRun(cart, 'run-123456', NOW), NOW);

describe('décisions sur la page ouverte', () => {
  it('rien tant que le remplissage n’est pas lancé', () => {
    expect(decide(newRun(cart, 'run-123456', NOW), product())).toEqual({ do: 'idle' });
  });

  it('fiche attendue : ajoute les paquets qui manquent', () => {
    expect(decide(running(), product())).toEqual({ do: 'add', clicks: 2, first: true, from: 0 });
    expect(decide(running(), product({ inCart: 1 }))).toEqual({ do: 'add', clicks: 1, first: false, from: 1 });
    expect(decide(running(), product({ inCart: null }))).toMatchObject({ clicks: 2, first: true });
  });

  it('déjà au panier en quantité suffisante : rien à ajouter', () => {
    expect(decide(running(), product({ inCart: 3 }))).toEqual({ do: 'already', inCart: 3 });
  });

  it('indisponible : passé, on continue', () => {
    expect(decide(running(), product({ canAdd: false, unavailable: true }))).toEqual({ do: 'skip', note: 'Indisponible au magasin choisi' });
  });

  it('fiche introuvable (produit retiré du site) : passée, on continue', () => {
    expect(decide(running(), { kind: 'gone' })).toEqual({ do: 'skip', note: 'Fiche introuvable sur le site' });
  });

  it('arrêt au premier captcha, page inattendue, autre produit, bouton absent', () => {
    expect(decide(running(), { kind: 'blocked', reason: 'Captcha' })).toEqual({ do: 'stop', reason: 'Captcha' });
    expect(decide(running(), { kind: 'other', what: 'page /' })).toMatchObject({ do: 'stop', reason: expect.stringMatching(/Page inattendue/u) });
    expect(decide(running(), product({ id: '1111111' }))).toMatchObject({ do: 'stop', reason: expect.stringMatching(/pas la fiche attendue/u) });
    expect(decide(running(), product({ canAdd: false }))).toMatchObject({ do: 'stop', reason: expect.stringMatching(/Ajouter/u) });
  });
});

describe('déroulé', () => {
  it('ligne après ligne jusqu’à la fin ; compte rendu', () => {
    let run = running();
    expect(lineUrl(run)).toBe(`${url('9990012')}#homehub-panier=run-123456`);
    run = afterLine(run, { status: 'added', inCart: 2, ean: '3000000000106', price: 2.35, note: null }, NOW);
    expect([run.phase, run.index, lineUrl(run)]).toEqual(['running', 1, `${url('9990014')}#homehub-panier=run-123456`]);
    run = afterLine(run, { status: 'skipped', inCart: 0, ean: null, price: null, note: 'Indisponible au magasin choisi' }, NOW);
    expect([run.phase, lineUrl(run)]).toEqual(['done', null]);
    expect(progress(run)).toMatchObject({ total: 2, added: 1, skipped: 1, waiting: 0 });
    expect(decide(run, product())).toEqual({ do: 'idle' });
    expect(toReport(run, NOW)).toEqual({
      kind: REPORT_KIND,
      version: 1,
      enseigne: 'coursesu',
      at: NOW.toISOString(),
      stop: null,
      lines: [
        { itemId: 'a', id: '9990012', name: 'Gruyère râpé, 200g', url: url('9990012'), status: 'added', count: 2, ean: '3000000000106', price: 2.35, note: null },
        { itemId: 'b', id: '9990014', name: 'Lessive Clair, 1,5L', url: url('9990014'), status: 'skipped', count: 0, ean: null, price: null, note: 'Indisponible au magasin choisi' },
      ],
    });
  });

  it('arrêt sur une ligne (règle d’arrêt) : marquée en échec ; reprise depuis elle', () => {
    let run = stopRun(running(), 'Captcha ou vérification anti-robots affichée par le site', NOW, { inCart: 1 });
    expect(run).toMatchObject({ phase: 'stopped', stop: 'Captcha ou vérification anti-robots affichée par le site', index: 0 });
    expect(run.lines[0]).toMatchObject({ status: 'failed', inCart: 1 });
    expect(lineStatus(run.lines[0])).toBe('Arrêt ici (1 paquet au panier)');
    expect(decide(run, product())).toEqual({ do: 'idle' });
    run = startRun(run, NOW);
    expect(run).toMatchObject({ phase: 'running', stop: null });
    expect(run.lines[0].status).toBe('waiting');
    // Reprise : la fiche montre déjà 1 paquet, il en manque 1.
    expect(decide(run, product({ inCart: 1 }))).toEqual({ do: 'add', clicks: 1, first: false, from: 1 });
  });

  it('arrêt par la personne entre deux produits : la ligne reste à faire', () => {
    const run = stopRun(running(), 'Arrêté par toi', NOW);
    expect(run.lines[0].status).toBe('waiting');
    expect(stopRun(run, 'encore', NOW)).toBe(run);
  });

  it('un remplissage fini ne se relance pas', () => {
    let run = afterLine(running(), { status: 'added', inCart: 2, ean: null, price: null, note: null }, NOW);
    run = afterLine(run, { status: 'already', inCart: 1, ean: null, price: null, note: null }, NOW);
    expect(startRun(run, NOW)).toBe(run);
  });

  it('premier essai : seulement les premiers produits, avant de commencer', () => {
    const ready = newRun(cart, 'run-123456', NOW);
    expect(limitRun(ready, 1).lines.map((l) => l.id)).toEqual(['9990012']);
    expect(limitRun(ready, 0)).toBe(ready);
    expect(limitRun(running(), 1).lines).toHaveLength(2);
  });

  it('marque du remplissage dans l’adresse', () => {
    expect(runIdIn('#homehub-panier=run-123456')).toBe('run-123456');
    expect(runIdIn('#avis')).toBeNull();
    expect(runIdIn('#homehub-panier=<script>')).toBeNull();
  });
});
