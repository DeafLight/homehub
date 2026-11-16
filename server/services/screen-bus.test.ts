// Tests de l'alerte du bus du matin sur la télé : quand le bandeau part, ce qu'il dit, une fois par jour, télé absente.
import { describe, expect, it } from 'vitest';
import type { ScreenEventBody, ScreenReport } from '../../shared/screen.ts';
import type { Commute } from '../../shared/types.ts';
import { busAlertOf, createScreenBusAlerts } from './screen-bus.ts';

const NOW = new Date(2026, 10, 5, 7, 35).getTime();
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const departure = (minutes: number, aimed?: number) => ({
  line: '3',
  destination: 'Lycée',
  at: at(minutes),
  realtime: true,
  ...(aimed !== undefined && { aimed: at(aimed) }),
});
const commute = (over: Partial<Commute> = {}): Commute => ({
  line: '3',
  stop: 'Ralliement',
  label: 'Collège',
  walkMinutes: 4,
  departures: [departure(2), departure(11), departure(26)],
  alerts: [],
  ...over,
});

describe('bandeau du bus', () => {
  it('plage fixe : la première course qu’on peut encore attraper, dans l’avance réglée', () => {
    // Course dans 2 min, 4 min de marche : déjà manquée ; celle dans 11 min → partir dans 7 min.
    expect(busAlertOf(commute(), 7, NOW, 'Léa')).toEqual({
      kind: 'bus',
      title: 'Bus dans 11 min',
      subtitle: 'Léa · ligne 3 vers Collège · pars dans 7 min',
      seconds: 45,
    });
    expect(busAlertOf(commute(), 6, NOW, 'Léa')).toBeNull(); // trop tôt
    expect(busAlertOf(commute({ departures: [] }), 30, NOW, 'Léa')).toBeNull();
  });

  it('heure de partir atteinte : « pars maintenant », puis plus rien une fois trop tard', () => {
    const now = new Date(at(7)).getTime();
    expect(busAlertOf(commute({ departures: [departure(11)] }), 5, now, 'Tom')?.subtitle).toBe('Tom · ligne 3 vers Collège · pars maintenant');
    // Arrêt devant la porte : « Le bus arrive » dans la dernière minute.
    expect(busAlertOf(commute({ departures: [departure(11)], walkMinutes: 0, label: undefined }), 5, now + 3.7 * 60_000, 'Tom')).toMatchObject({
      title: 'Le bus arrive',
      subtitle: 'Tom · ligne 3 · pars maintenant',
    });
    expect(busAlertOf(commute({ departures: [departure(11)] }), 5, now + 2 * 60_000, 'Tom')).toBeNull();
  });

  it('selon l’emploi du temps : la course prévue, à son heure du temps réel', () => {
    const plan = { departs: at(20), arrives: at(35), leaveAt: at(16), firstCourse: at(60), firstCancelled: false };
    // La course prévue à +20 a 2 min de retard (temps réel +22) : partir à +18.
    const c = commute({ departures: [departure(11), departure(22, 20)], plan });
    expect(busAlertOf(c, 10, NOW, 'Léa')).toBeNull(); // la course de +11 n'est pas celle prévue
    expect(busAlertOf(c, 18, NOW, 'Léa')?.title).toBe('Bus dans 22 min');
    // Course prévue absente du temps réel : son horaire théorique.
    expect(busAlertOf(commute({ departures: [], plan }), 16, NOW, 'Léa')?.title).toBe('Bus dans 20 min');
  });

  it('itinéraire de MOTIS avec correspondance : « ligne 3 puis tram A »', () => {
    const legs = [
      { line: '3', from: 'Ralliement', to: 'Gare', departs: at(20), arrives: at(28) },
      { line: 'A', from: 'Gare', to: 'Les Collèges', departs: at(32), arrives: at(38) },
    ];
    const plan = { departs: at(20), arrives: at(41), leaveAt: at(16), firstCourse: at(60), firstCancelled: false, legs };
    expect(busAlertOf(commute({ departures: [departure(20, 20)], plan }), 16, NOW, 'Léa')?.subtitle).toBe('Léa · ligne 3 puis tram A vers Collège · pars dans 16 min');
  });
});

describe('envoi aux télés', () => {
  function setup(online: boolean[]) {
    let now = NOW;
    const sent: { id: string; event: ScreenEventBody }[] = [];
    const state = { online };
    const errors: string[] = [];
    // Les passages suivent l'horloge : dans 2, 11 et 26 min, quel que soit le jour.
    const later = (minutes: number) => ({ ...departure(0), at: new Date(now + minutes * 60_000).toISOString() });
    let wanted: (() => { commute: Commute; minutes: number }) | null = () => ({ commute: commute({ departures: [later(2), later(11), later(26)] }), minutes: 10 });
    const alerts = createScreenBusAlerts({
      members: () => [
        { id: 'lea', name: 'Léa' },
        { id: 'tom', name: 'Tom' },
      ],
      alertOf: async (id) => (id === 'lea' && wanted ? wanted() : null),
      screens: async () => state.online.map((_, i) => `tele${i}`),
      hub: {
        online: (id) => state.online[Number(id.slice(4))] ?? false,
        send: async (id, event): Promise<ScreenReport> => {
          sent.push({ id, event });
          return id === 'tele1' ? { ok: false, reason: 'pas d’autorisation' } : { ok: true };
        },
      },
      clock: () => new Date(now),
      logger: { log: () => {}, error: (m: string) => errors.push(m) },
    });
    return {
      alerts,
      sent,
      errors,
      state,
      advance: (ms: number) => (now += ms),
      set: (w: typeof wanted) => (wanted = w),
    };
  }

  it('une alerte par membre et par jour, à chaque télé joignable', async () => {
    const t = setup([true, true, false]);
    await t.alerts.tick();
    expect(t.sent.map((s) => s.id)).toEqual(['tele0', 'tele1']);
    expect(t.sent[0]?.event).toMatchObject({ kind: 'bus', title: 'Bus dans 11 min' });
    expect(t.errors).toEqual(['Alerte du bus sur la télé tele1 : pas d’autorisation']);
    await t.alerts.tick();
    expect(t.sent).toHaveLength(2); // déjà envoyée aujourd'hui
    t.advance(86_400_000);
    await t.alerts.tick();
    expect(t.sent).toHaveLength(4); // le lendemain, de nouveau
  });

  it('aucune télé joignable : réessaie tant qu’il est temps ; rien sans alerte voulue', async () => {
    const t = setup([false]);
    await t.alerts.tick();
    expect(t.sent).toEqual([]);
    t.state.online = [true];
    await t.alerts.tick();
    expect(t.sent).toHaveLength(1);

    const quiet = setup([true]);
    quiet.set(null);
    await quiet.alerts.tick();
    expect(quiet.sent).toEqual([]);
  });
});
