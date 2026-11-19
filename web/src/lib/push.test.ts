// Tests des notifications côté navigateur : sur iPhone seulement une fois ajouté à l'écran d'accueil, connexion
// sécurisée exigée, diagnostic (permission, abonnement du navigateur et du serveur) et clé publique VAPID en octets.
import { describe, expect, it } from 'vitest';
import { keyBytes, pushHealth, pushSupport, type PushEnvironment, type PushHealthInput } from './push.ts';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1';
const env = (patch: Partial<PushEnvironment>): PushEnvironment => ({ userAgent: ANDROID, standalone: false, secure: true, serviceWorker: true, pushManager: true, notification: true, ...patch });

describe('pushSupport', () => {
  it('Android : possible dans le navigateur', () => expect(pushSupport(env({}))).toBe('ok'));

  it('iPhone : seulement ouvert depuis l’écran d’accueil', () => {
    expect(pushSupport(env({ userAgent: IPHONE, pushManager: false, notification: false }))).toBe('ios-install');
    expect(pushSupport(env({ userAgent: IPHONE, standalone: true }))).toBe('ok');
  });

  it('connexion non sécurisée, ou navigateur sans notifications', () => {
    expect(pushSupport(env({ secure: false }))).toBe('insecure');
    expect(pushSupport(env({ pushManager: false }))).toBe('unsupported');
  });
});

describe('pushHealth', () => {
  const E = 'https://push.exemple.test/abc';
  const ok = (patch: Partial<PushHealthInput> = {}) =>
    pushHealth({ support: 'ok', permission: 'granted', localEndpoint: E, server: { subscribed: true, endpoint: E }, ...patch });

  it('tout est bon : actives, avec l’essai', () => expect(ok()).toEqual({ state: 'active', action: 'test' }));

  it('pas pris en charge d’abord, quoi que disent permission et serveur', () => {
    expect(ok({ support: 'ios-install' })).toEqual({ state: 'ios-install', action: 'none' });
    expect(ok({ support: 'insecure' }).state).toBe('insecure');
    expect(ok({ support: 'unsupported' }).state).toBe('unsupported');
    expect(ok({ permission: null }).state).toBe('unsupported');
  });

  it('permission à demander, ou refusée (impossible de redemander)', () => {
    expect(ok({ permission: 'default', localEndpoint: null, server: null })).toEqual({ state: 'ask', action: 'enable' });
    expect(ok({ permission: 'denied' })).toEqual({ state: 'denied', action: 'none' });
  });

  it('serveur pas encore lu : vérification en cours', () => expect(ok({ server: null })).toEqual({ state: 'checking', action: 'none' }));

  it('coupées des deux côtés : à activer, pas à réparer', () => {
    expect(ok({ localEndpoint: null, server: { subscribed: false, endpoint: null } })).toEqual({ state: 'off', action: 'enable' });
  });

  it('abonnement perdu par le navigateur, par le serveur, ou adresses différentes : à réparer', () => {
    expect(ok({ localEndpoint: null })).toEqual({ state: 'repair', reason: 'browser', action: 'repair' });
    expect(ok({ server: { subscribed: false, endpoint: null } })).toEqual({ state: 'repair', reason: 'server', action: 'repair' });
    expect(ok({ server: { subscribed: true, endpoint: 'https://push.exemple.test/autre' } })).toEqual({ state: 'repair', reason: 'mismatch', action: 'repair' });
  });
});

describe('keyBytes', () => {
  it('base64url sans remplissage → octets', () => {
    expect([...keyBytes('BP4z-_8')]).toEqual([0x04, 0xfe, 0x33, 0xfb, 0xff]);
  });
});
