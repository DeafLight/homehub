// Heure du coucher des enfants côté front (tablette, téléphone d'un parent) : phrase qui dit où en est le coucher de ce
// soir, boutons permis, et modification d'un soir dans un tableau d'heures. Fonctions pures, testées
// (bedtime.test.ts) ; les règles elles-mêmes sont dans shared/bedtime.ts.
import {
  BEDTIME_EARLIEST,
  BEDTIME_LATEST,
  BEDTIME_POSTPONE_STEP_MIN,
  BEDTIME_SCHEDULE_LABELS,
  type BedtimeSettings,
  type BedtimeTonight,
  type BedtimeWeek,
} from '../../../shared/bedtime.ts';

/** Ce que dit la ligne « Ce soir » ; `detail` : le tableau suivi et le report éventuel. */
export function tonightLine(settings: Pick<BedtimeSettings, 'enabled'>, tonight: BedtimeTonight): { text: string; detail: string | null } {
  const schedule = BEDTIME_SCHEDULE_LABELS[tonight.schedule].toLowerCase();
  const delay = tonight.delayMin > 0 ? `repoussé de ${tonight.delayMin} min` : null;
  if (!settings.enabled) return { text: 'Coucher coupé : rien ne se passe sur la télé', detail: null };
  if (tonight.state === 'cancelled') return { text: 'Pas de coucher ce soir : annulé par un parent', detail: null };
  if (tonight.state === 'off' || !tonight.time || !tonight.stages) return { text: 'Pas de coucher prévu ce soir', detail: schedule };
  const s = tonight.stages;
  const text = {
    before: `Au lit à ${tonight.time} : rappel à ${s.reminder}, écran de veille à ${s.sleep}`,
    reminder: `Rappel affiché : au lit à ${tonight.time}`,
    pause: `Télé en pause depuis ${s.pause} : écran de veille à ${s.sleep}`,
    sleep: `Écran de veille depuis ${s.sleep} (coucher de ${tonight.time})`,
  }[tonight.state];
  return { text, detail: [schedule, delay].filter(Boolean).join(' · ') };
}

/** Boutons offerts ce soir : repousser (avec la nouvelle heure), annuler, rétablir. */
export function tonightActions(tonight: BedtimeTonight): { postpone: string | null; cancel: boolean; restore: boolean } {
  const live = tonight.state !== 'off' && tonight.state !== 'cancelled';
  return {
    postpone: live && tonight.canPostpone ? `+${BEDTIME_POSTPONE_STEP_MIN} min` : null,
    cancel: live,
    restore: tonight.state === 'cancelled' || (live && tonight.delayMin > 0),
  };
}

/** Le tableau `week` avec le soir `index` changé ; une heure hors du soir (ou effacée) devient « pas de coucher ». */
export function withDay(week: BedtimeWeek, index: number, value: string): BedtimeWeek {
  const time = /^\d{2}:\d{2}$/u.test(value) && value >= BEDTIME_EARLIEST && value <= BEDTIME_LATEST ? value : null;
  return week.map((t, i) => (i === index ? time : t));
}
