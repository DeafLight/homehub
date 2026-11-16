// Heure du coucher des enfants sur les télés (fonction 16, shared/bedtime.ts) : toutes les 30 s, le temps dû de ce soir
// (rappel, pause, écran de veille) part vers chaque télé allumée, une seule fois. Le rappel passe par le bandeau des
// rappels du soir (événement `reminder`, fonction 5), la pause par la touche pause et son bandeau (comme « À table ! »,
// fonction 6), l'écran de veille par l'événement `bedtime` qui ouvre la page de l'écran de veille HomeHub (fonction 8).
// Aucune télé allumée : le temps attend qu'une télé s'allume, pendant la demi-heure de rattrapage. Un parent peut
// repousser l'heure (par quart d'heure, une heure au plus) ou annuler pour ce soir : les télés allumées le disent en
// bandeau et quittent l'écran de veille du coucher s'il est ouvert ; les temps déjà passés ne repartent pas.
import { randomUUID } from 'node:crypto';
import {
  BEDTIME_BANNER_SECONDS,
  BEDTIME_POSTPONE_STEP_MIN,
  BEDTIME_STAGES,
  type BedtimeSettings,
  type BedtimeStage,
  type BedtimeText,
  type BedtimeTonight,
  type BedtimeView,
  bedtimeChangeText,
  bedtimePauseText,
  bedtimeReminderText,
  bedtimeTonight,
  dueStage,
  passedStage,
  toMinutes,
} from '../../shared/bedtime.ts';
import { localDay } from '../../shared/dates.ts';
import type { SchoolHoliday } from '../../shared/school-holidays.ts';
import type { ScreenEventBody } from '../../shared/screen.ts';
import type { ScreenReminderEvent } from '../../shared/screen-reminders.ts';
import type { Author } from '../../shared/types.ts';
import { fail } from '../http.ts';
import type { BedtimeStore } from '../sources/bedtime.ts';
import type { Clock } from '../sources/types.ts';
import { SCREEN_OFFLINE, type ScreenHub } from './screens.ts';

export const BEDTIME_TICK_MS = 30_000;
/** Attente du compte rendu de la télé (l'écran de veille demande d'ouvrir une page). */
export const BEDTIME_REPORT_MS = 8_000;
export const BEDTIME_OFF = 'Pas de coucher prévu ce soir';
export const BEDTIME_CANCELLED = 'Coucher déjà annulé pour ce soir';
export const BEDTIME_NO_MORE = 'Coucher déjà repoussé d’une heure : c’est le plus tard possible';
export const BEDTIME_NOT_CANCELLED = 'Le coucher de ce soir n’est pas annulé';

const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes();

export type Bedtime = ReturnType<typeof createBedtime>;

export function createBedtime({
  store,
  hub,
  screenIds,
  holidays,
  children,
  nameOf,
  clock,
  logger = console,
}: {
  store: BedtimeStore;
  hub: Pick<ScreenHub, 'power' | 'send'>;
  /** Identifiants des télés appairées. */
  screenIds: () => Promise<string[]>;
  /** Vacances scolaires (null ou vide : jamais de vacances). */
  holidays: () => Promise<readonly SchoolHoliday[] | null>;
  /** Prénoms des enfants de la maison, dans l'ordre de la config. */
  children: () => string[];
  nameOf: (ownerId: string) => string | null;
  clock: Clock;
  logger?: Pick<Console, 'error' | 'log'>;
}) {
  const allumees = async () => (await screenIds()).filter((id) => hub.power(id) === 'on');

  async function tonight(now = clock()): Promise<{ settings: BedtimeSettings; tonight: BedtimeTonight }> {
    const day = localDay(now);
    const [settings, evening, list] = await Promise.all([store.settings(), store.evening(day), holidays().catch(() => null)]);
    return { settings, tonight: bedtimeTonight({ settings, holidays: list ?? [], day, nowMin: minutesOf(now), delayMin: evening.delayMin, cancelled: evening.cancelled }) };
  }

  /** Envoie `event` (refait pour chaque télé) aux télés `ids` ; renvoie le nombre de télés qui l'ont fait. */
  async function push(make: () => ScreenEventBody, ids: string[], what: string): Promise<number> {
    const reports = await Promise.all(
      ids.map(async (id) => {
        const report = await hub.send(id, make(), BEDTIME_REPORT_MS).catch((err: unknown) => ({ ok: false as const, reason: (err as Error).message }));
        if (!report.ok) logger.error(`Coucher, ${what} non fait sur la télé ${id} : ${report.reason}`);
        return report.ok;
      }),
    );
    return reports.filter(Boolean).length;
  }

  const banner = (text: BedtimeText) => (): ScreenReminderEvent => ({ kind: 'reminder', id: randomUUID(), reminder: 'bedtime', ...text, seconds: BEDTIME_BANNER_SECONDS });

  /** L'événement d'un temps du coucher. */
  function stageEvent(stage: BedtimeStage, time: string, nowMin: number): () => ScreenEventBody {
    if (stage === 'reminder') return banner(bedtimeReminderText(children(), time, nowMin));
    if (stage === 'pause') return () => ({ kind: 'key', id: randomUUID(), keys: ['pause'], notice: bedtimePauseText(children()) });
    return () => ({ kind: 'bedtime', id: randomUUID(), action: 'sleep' });
  }

  /** Une vérification : envoie le temps dû de ce soir. */
  async function tick() {
    const now = clock();
    const { tonight: t } = await tonight(now);
    if (t.state === 'off' || t.state === 'cancelled' || !t.time || !t.stages) return;
    const evening = await store.evening(t.day);
    const sent = evening.sentFor === t.time ? evening.sent : -1;
    const stage = dueStage(t.stages, minutesOf(now), sent);
    if (!stage) return;
    const ids = await allumees();
    // Aucune télé allumée : on réessaie au prochain passage, tant que dure le rattrapage.
    if (!ids.length) return;
    await store.setEvening({ ...evening, sent: BEDTIME_STAGES.indexOf(stage), sentFor: t.time });
    const done = await push(stageEvent(stage, t.time, minutesOf(now)), ids, stage);
    logger.log(`Coucher de ${t.time}, ${stage} : ${done} télé(s) sur ${ids.length}`);
  }

  /**
   * Après un report, une annulation ou un rétablissement : les temps déjà passés à la nouvelle heure comptent comme
   * envoyés (rien ne repart d'un coup), les télés allumées affichent le bandeau qui le dit et quittent l'écran de veille
   * du coucher s'il était ouvert et que l'heure n'est plus passée.
   */
  async function announce(change: 'postponed' | 'cancelled' | 'restored', by: Author, before: number): Promise<BedtimeView & { screens: number }> {
    const now = clock();
    const view = await tonight(now);
    const t = view.tonight;
    const evening = await store.evening(t.day);
    const passed = t.stages && t.state !== 'cancelled' ? passedStage(t.stages, minutesOf(now)) : -1;
    await store.setEvening({ ...evening, sent: passed, sentFor: t.time });
    const ids = await allumees();
    const sender = by.ownerId ? nameOf(by.ownerId) : null;
    let screens = 0;
    if (ids.length) {
      if (before >= BEDTIME_STAGES.indexOf('sleep') && passed < BEDTIME_STAGES.indexOf('sleep')) {
        await push(() => ({ kind: 'bedtime', id: randomUUID(), action: 'wake' }), ids, 'fin de l’écran de veille');
      }
      screens = await push(banner(bedtimeChangeText(change, t.time, sender)), ids, 'bandeau');
    }
    return { ...view, screens };
  }

  /** Dernier temps envoyé ce soir pour l'heure retenue (-1 aucun). */
  async function sentTonight(t: BedtimeTonight) {
    const evening = await store.evening(t.day);
    return evening.sentFor === t.time ? evening.sent : -1;
  }

  return {
    tick,
    tonight,

    /** Vérifie toutes les BEDTIME_TICK_MS ; renvoie de quoi arrêter. */
    start(intervalMs = BEDTIME_TICK_MS) {
      const timer = setInterval(() => void tick().catch((err: unknown) => logger.error('Coucher sur la télé :', err)), intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },

    async saveSettings(settings: BedtimeSettings, by: Author) {
      await store.save(settings, by, clock());
      return tonight();
    },

    /** Repousse le coucher de ce soir d'un quart d'heure (parent). */
    async postpone(by: Author) {
      const { tonight: t } = await tonight();
      if (t.state === 'off') return fail(409, BEDTIME_OFF);
      if (t.state === 'cancelled') return fail(409, BEDTIME_CANCELLED);
      if (!t.canPostpone) return fail(409, BEDTIME_NO_MORE);
      const before = await sentTonight(t);
      const evening = await store.evening(t.day);
      await store.setEvening({ ...evening, delayMin: evening.delayMin + BEDTIME_POSTPONE_STEP_MIN });
      return announce('postponed', by, before);
    },

    /** Annule le coucher de ce soir (parent). */
    async cancel(by: Author) {
      const { tonight: t } = await tonight();
      if (t.state === 'off') return fail(409, BEDTIME_OFF);
      if (t.state === 'cancelled') return fail(409, BEDTIME_CANCELLED);
      const before = await sentTonight(t);
      await store.setEvening({ ...(await store.evening(t.day)), cancelled: true });
      return announce('cancelled', by, before);
    },

    /** Rétablit le coucher de ce soir à l'heure prévue (annulation et report effacés). */
    async restore(by: Author) {
      const { tonight: t } = await tonight();
      if (t.state === 'off') return fail(409, BEDTIME_OFF);
      if (t.state !== 'cancelled' && t.delayMin === 0) return fail(409, BEDTIME_NOT_CANCELLED);
      const before = t.state === 'cancelled' ? -1 : await sentTonight(t);
      await store.setEvening({ ...(await store.evening(t.day)), cancelled: false, delayMin: 0 });
      return announce('restored', by, before);
    },

    /** « Essayer » (tablette) : le bandeau du rappel tout de suite, quelle que soit l'heure ; rien n'est mis en pause. */
    async tryReminder(): Promise<BedtimeText & { screens: number }> {
      const { settings, tonight: t } = await tonight();
      const ids = await allumees();
      if (!ids.length) return fail(503, SCREEN_OFFLINE);
      // Le bandeau tel qu'il paraîtra ce soir (heure de ce soir, sinon celle du lundi d'école).
      const time = t.time ?? t.planned ?? settings.school[1] ?? '20:30';
      const text = bedtimeReminderText(children(), time, toMinutes(time) - settings.reminderMin);
      const screens = await push(banner(text), ids, 'essai du rappel');
      if (!screens) return fail(502, 'La télé n’a pas affiché le rappel');
      return { ...text, screens };
    },
  };
}
