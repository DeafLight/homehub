// Affichage de « J'ai cuisiné » (logique pure, testée) : les boutons de réponse de chaque ligne, la proposition écrite,
// le produit, « Tout comme proposé », ce que le bouton du bas va retirer, le bandeau après coup, la question
// regroupée pour la liste de courses, la marque « Cuisiné · Alex, 19 h 40 » d'un repas, et quand demander
// « Cuisiné ? ». La proposition vient du serveur (shared/cook.ts) ; ici, seulement la présentation.
import { type CookAnswer, type CookedMark, type CookLine, type CookMeal, type CookOption, type CookReply, type CookResult, type CookUndo, type Estimate, estimateLabel, needLabel } from '../../../shared/cook.ts';
import { type MenuView, type MenuViewEntry } from '../../../shared/menu.ts';
import { formatAmount } from '../../../shared/quantities.ts';
import { dayLabel } from './menu.ts';

/** Un bouton de réponse d'une ligne ; `suggested` : la proposition (entourée de bleu, jamais choisie d'avance). */
export type AnswerButton = { id: string; label: string; answer: CookAnswer; suggested: boolean };

const same = (a: CookAnswer, b: CookAnswer | null) => b !== null && JSON.stringify(a) === JSON.stringify(b);

/** Paquets finis de la proposition d'un produit utilisé en plusieurs fois, avant celui qui est entamé. */
function finishedOf(proposal: CookAnswer | null): number {
  if (proposal?.action === 'left') return proposal.finished;
  if (proposal?.action === 'remove') return proposal.count - 1;
  return 0;
}

/** Les réponses possibles d'une option ; `counter` : la valeur du compteur (unités qui ne se comparent pas). */
export function answerButtons(option: CookOption, counter = option.counter): AnswerButton[] {
  const button = (id: string, label: string, answer: CookAnswer): AnswerButton => ({ id, label, answer, suggested: same(answer, option.proposal) });
  const unused = button('unused', 'Pas utilisé', { action: 'unused' });
  switch (option.kind) {
    case 'container':
      return [button('empty', 'Vide', { action: 'empty' }), button('kept', 'Il en reste', { action: 'kept' })];
    case 'once': {
      const count = option.proposal?.action === 'remove' ? option.proposal.count : 1;
      return [button('remove', `Retirer ${count}`, { action: 'remove', count }), unused];
    }
    case 'count':
      return [button('remove', `Retirer ${counter}`, { action: 'remove', count: counter }), unused];
    case 'taste':
      return [button('remove', 'Utilisé, fini', { action: 'remove', count: 1 }), button('left', 'Il en reste', { action: 'left', finished: 0, estimate: null }), unused];
    case 'partial': {
      const finished = Math.min(finishedOf(option.proposal), option.stock - 1);
      const all = finished + 1;
      const estimate: Estimate = option.proposal?.action === 'left' && option.proposal.estimate !== null ? option.proposal.estimate : 0.5;
      return [
        button('remove', all === 1 ? 'Paquet fini' : `${all} finis`, { action: 'remove', count: all }),
        button('left', finished === 0 ? 'Il en reste' : `${finished} fini${finished > 1 ? 's' : ''}, il en reste`, { action: 'left', finished, estimate }),
        unused,
      ];
    }
  }
}

/** Le bouton qui correspond à une réponse donnée (l'estimation d'« Il en reste » peut avoir changé). */
export function buttonOf(buttons: readonly AnswerButton[], answer: CookAnswer | null): string | null {
  if (!answer) return null;
  return buttons.find((b) => b.answer.action === answer.action)?.id ?? null;
}

/** L'estimation se choisit (¼ · ½ · ¾) quand il en reste d'un produit utilisé en plusieurs fois. */
export const asksEstimate = (option: CookOption, answer: CookAnswer | null) => answer?.action === 'left' && option.kind === 'partial';

/** « Penne · 500 g · 2 en stock · s'utilise en plusieurs fois · entamé, il en reste ½ ». */
export function productText(option: CookOption): string {
  if (option.kind === 'container') return `${option.name} (recharge transvasée)`;
  const parts = [option.name];
  if (option.per) parts.push(formatAmount(option.per));
  parts.push(`${option.stock} en stock`);
  if (option.partial) parts.push(option.opened !== null ? `entamé, il en reste ${estimateLabel(option.opened)}` : 's’utilise en plusieurs fois');
  return parts.join(' · ');
}

/** La proposition écrite sur la ligne : « Proposé : il en reste à peu près ¼ (400 g sur 500 g) ». */
export function hintText(line: CookLine, option: CookOption): string {
  const need = needLabel(line);
  const per = option.per ? formatAmount(option.per) : null;
  const p = option.proposal;
  switch (option.kind) {
    case 'container':
      return `Le ${option.name.toLowerCase().split(' ')[0]} est vide ?`;
    case 'taste':
      return line.optional ? 'Facultatif : rien de proposé' : 'À goût : rien de proposé';
    case 'count':
      return p ? `Pas de calcul possible : combien de paquets finis ? (la recette en compte ${p.action === 'remove' ? p.count : 1})` : 'Les unités ne se comparent pas : combien de paquets finis ?';
    case 'once':
      return p?.action === 'remove' ? `Proposé : retirer ${p.count}${option.stock === p.count ? ' (le dernier)' : ''}` : '';
    case 'partial':
      if (p?.action === 'left') {
        const done = p.finished > 0 ? `${p.finished} paquet${p.finished > 1 ? 's' : ''} fini${p.finished > 1 ? 's' : ''}, ` : '';
        return `Proposé : ${done}il en reste à peu près ${estimateLabel(p.estimate ?? 0.5)}${need && per ? ` (${need} sur ${per})` : ''}`;
      }
      return p?.action === 'remove' ? `Proposé : ${p.count > 1 ? `${p.count} paquets finis` : 'paquet fini'}${need && per ? ` (${need} sur ${per})` : ''}` : '';
  }
}

/** Ce qu'on a choisi sur une ligne : l'option (produit ou contenant) et la réponse. */
export type Choice = { option: number; answer: CookAnswer | null; counter: number };

/** Les réponses à envoyer : les lignes qui en ont une. */
export function repliesOf(lines: readonly CookLine[], choices: Readonly<Record<string, Choice>>): CookReply[] {
  const replies: CookReply[] = [];
  for (const line of lines) {
    const choice = choices[line.key];
    const option = choice ? line.options[choice.option] : undefined;
    if (!choice?.answer || !option) continue;
    const answer = option.kind === 'count' && choice.answer.action === 'remove' ? { action: 'remove' as const, count: choice.counter } : choice.answer;
    replies.push({ key: line.key, code: option.code, container: option.container?.id ?? null, answer });
  }
  return replies;
}

/** Réponses qui changent le stock (le nombre du bouton « Retirer du stock (N) »). */
export const stockChanges = (replies: readonly CookReply[]) =>
  replies.filter((r) => r.answer.action === 'remove' || r.answer.action === 'empty' || (r.answer.action === 'left' && (r.answer.finished > 0 || r.answer.estimate !== null))).length;

/** « Tout comme proposé » : la proposition de chaque ligne sans réponse (celles déjà répondues restent). */
export function allAsProposed(lines: readonly CookLine[], choices: Readonly<Record<string, Choice>>): Record<string, Choice> {
  const next: Record<string, Choice> = { ...choices };
  for (const line of lines) {
    if (line.status !== 'stock' || next[line.key]?.answer) continue;
    const index = next[line.key]?.option ?? 0;
    const option = line.options[index];
    if (!option?.proposal) continue;
    next[line.key] = { option: index, answer: option.proposal, counter: option.proposal.action === 'remove' ? option.proposal.count : option.counter };
  }
  return next;
}

/** Lignes qui ont une proposition (« Tout comme proposé » ne sert que s'il y en a une sans réponse). */
export const proposable = (lines: readonly CookLine[], choices: Readonly<Record<string, Choice>>) =>
  lines.some((l) => l.status === 'stock' && !choices[l.key]?.answer && l.options[choices[l.key]?.option ?? 0]?.proposal);

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};

/** « Cuisiné · Alex, 19 h 40 » ; un autre jour : « Cuisiné · Alex, mardi 10, 19 h 40 » ; sans auteur : « Cuisiné, 19 h 40 ». */
export function cookedLabel(mark: Pick<CookedMark, 'at' | 'by'>, today: string, nameOf: (id: string | null) => string | null): string {
  const name = nameOf(mark.by.ownerId);
  const d = new Date(mark.at);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const when = day === today ? timeOf(mark.at) : `${dayLabel(day).toLowerCase()}, ${timeOf(mark.at)}`;
  return name ? `Cuisiné · ${name}, ${when}` : `Cuisiné, ${when}`;
}

/** « Cuisiné ? » sur un repas : semaine encore ouverte, pas encore noté, d'aujourd'hui, d'un jour passé ou sans jour. */
export const asksCooked = (entry: Pick<MenuViewEntry, 'day' | 'cooked'>, view: Pick<MenuView, 'cookable' | 'today'>) =>
  view.cookable && !entry.cooked && (entry.day === null || entry.day <= view.today);

/** Repas passés pas encore notés, dans la vue d'une semaine. */
export const uncookedPast = (view: Pick<MenuView, 'cookable' | 'today' | 'entries'>) =>
  view.cookable ? view.entries.filter((e) => !e.cooked && e.day !== null && e.day < view.today).length : 0;

/** « 2 repas passés : cuisinés ? » (ligne discrète de l'accueil et du menu) ; vide s'il n'y en a pas. */
export const reminderText = (count: number) => (count === 0 ? '' : count === 1 ? '1 repas passé : cuisiné ?' : `${count} repas passés : cuisinés ?`);

/** « Repas d'aujourd'hui », « Repas de jeudi 12 », « Repas de la semaine », « Hors menu ». */
export function mealText(meal: Pick<CookMeal, 'day'> | null, today: string): string {
  if (!meal) return 'Hors menu';
  if (meal.day === null) return 'Repas de la semaine, sans jour';
  if (meal.day === today) return 'Repas d’aujourd’hui';
  return `Repas de ${dayLabel(meal.day).toLowerCase()}`;
}

/** Bandeau après le décompte : « Retiré du stock : penne, thon × 2 » ; rien retiré : « Noté cuisiné ». */
export function resultText(result: Pick<CookResult, 'removed' | 'mealId'>): string {
  if (result.removed.length) return `Retiré du stock : ${result.removed.join(', ')}`;
  return result.mealId ? 'Noté cuisiné, rien retiré du stock' : 'Rien retiré du stock';
}

/** Coches « j'en ai déjà » retirées : « Gruyère : plus de paquet, de retour dans les courses pour Gratin ». */
export const returnedText = (returned: CookResult['returned']) => returned.map((r) => `${r.name} : plus de paquet, de retour dans les courses pour ${r.sources.join(', ')}`);

/** « Plus de crème fraîche : sur la liste ? », « Plus de crème fraîche ni de thon : sur la liste ? ». */
export function shoppingQuestion(labels: readonly string[]): string {
  const names = labels.map((l) => l.toLowerCase());
  const list = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ni de ${names.at(-1)}`;
  return `Plus de ${list} : sur la liste de courses ?`;
}

/** Après « Annuler » : rien à dire, ou ce qui a bougé depuis. */
export function undoText(undo: CookUndo): string {
  if (undo.kept.length === 0) return 'Annulé';
  return `Annulé, sauf ${undo.kept.join(', ')} : bougé depuis, à corriger sur la page Stock`;
}

/** Ce qu'ouvre le panneau : un repas du menu, ou une recette (`entryId` absent : repas pris d'office ; null : hors menu). */
export type CookTarget = { entryId: string } | { recipeId: string; entryId?: string | null };
