// Tests du service du mode film (fonction 15) : état d'une télé selon son appli et les choix à la main, réglage
// automatique, choix oubliés télé éteinte (au guet), choix refusé télé en veille, et bandeaux rendus discrets par le
// hub pendant un film (pas le message vocal ni les touches).
import { describe, expect, it } from 'vitest';
import { FILM_MANUAL_MS } from '../../shared/screen-film.ts';
import type { RemotePower, ScreenStateReport } from '../../shared/screen.ts';
import { NOW } from '../testing.ts';
import { createScreenFilm } from './screen-film.ts';
import { createScreenHub } from './screens.ts';

const NETFLIX = 'com.netflix.ninja';

function setup() {
  let now = NOW.getTime();
  const tv = { power: 'on' as RemotePower, foreground: null as string | null };
  const hub = {
    power: () => tv.power,
    stateOf: (): ScreenStateReport => ({ screenOn: tv.power === 'on', foreground: tv.foreground, control: 'adb', addresses: [] }),
  };
  const film = createScreenFilm({ hub, clock: () => new Date(now) });
  return { film, tv, advance: (ms: number) => (now += ms) };
}

describe('service du mode film', () => {
  it('automatique selon l’appli, coupé par le réglage de la tablette', () => {
    const { film, tv } = setup();
    expect(film.on('t')).toBe(false);
    tv.foreground = NETFLIX;
    expect(film.state('t')).toEqual({ on: true, why: 'auto', until: null });
    film.setAuto(false);
    expect(film.auto).toBe(false);
    expect(film.discreet('t')).toBe(false);
  });

  it('à la main : allumé, puis fini au bout de quatre heures', () => {
    const { film, advance } = setup();
    expect(film.set('t', true)).toMatchObject({ on: true, why: 'manual' });
    advance(FILM_MANUAL_MS - 1_000);
    expect(film.on('t')).toBe(true);
    advance(1_000);
    expect(film.on('t')).toBe(false);
  });

  it('télé mise en veille : le choix à la main est oublié par le guet, et ne revient pas au réveil', () => {
    const { film, tv } = setup();
    film.set('t', true);
    tv.power = 'standby';
    film.sweep();
    tv.power = 'on';
    expect(film.state('t')).toEqual({ on: false, why: null, until: null });
  });

  it('éteint à la main pendant Netflix, puis autre appli : l’automatique reprend au retour sur Netflix', () => {
    const { film, tv } = setup();
    tv.foreground = NETFLIX;
    expect(film.set('t', false)).toEqual({ on: false, why: 'manual', until: null });
    tv.foreground = 'fr.exemple.video';
    expect(film.state('t').why).toBeNull();
    tv.foreground = NETFLIX;
    expect(film.on('t')).toBe(true);
  });

  it('télé en veille ou injoignable : rien à régler', () => {
    const { film, tv } = setup();
    tv.power = 'standby';
    expect(film.set('t', true)).toBeNull();
    tv.power = 'offline';
    expect(film.set('t', true)).toBeNull();
  });
});

describe('hub : bandeaux discrets pendant un film', () => {
  it('message, bus et rappel partent discrets ; voix et touches restent telles quelles ; autre télé : rien', async () => {
    const hub = createScreenHub({ clock: () => NOW, waitMs: 10, reportMs: 50 });
    const film = new Set(['salon']);
    hub.useDiscreet((id) => film.has(id));
    await hub.events('salon', null);
    await hub.events('chambre', null);
    const banner = { title: 'Bus', subtitle: 'dans 5 min', seconds: 30 };
    void hub.send('salon', { kind: 'bus', id: 'b1', ...banner });
    void hub.send('salon', { kind: 'message', id: 'm1', title: 'Message d’Alex', text: 'Coucou', seconds: 10 });
    void hub.send('salon', { kind: 'reminder', id: 'r1', reminder: 'notes', title: 'Mots', subtitle: 'Léa', seconds: 20 });
    void hub.send('salon', { kind: 'key', id: 'k1', keys: ['pause'] });
    void hub.send('chambre', { kind: 'bus', id: 'b2', ...banner });
    const salon = await hub.events('salon', 0);
    expect(salon.events.map((e) => [e.kind, 'discreet' in e ? e.discreet : undefined])).toEqual([
      ['bus', true],
      ['message', true],
      ['reminder', true],
      ['key', undefined],
    ]);
    const chambre = await hub.events('chambre', 0);
    expect(chambre.events[0]).not.toHaveProperty('discreet');
  });
});
