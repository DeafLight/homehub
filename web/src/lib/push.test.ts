// Tests des notifications côté navigateur : sur iPhone seulement une fois ajouté à l'écran d'accueil, connexion
// sécurisée exigée, et clé publique VAPID convertie en octets.
import { describe, expect, it } from 'vitest';
import { keyBytes, pushSupport, type PushEnvironment } from './push.ts';

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

describe('keyBytes', () => {
  it('base64url sans remplissage → octets', () => {
    expect([...keyBytes('BP4z-_8')]).toEqual([0x04, 0xfe, 0x33, 0xfb, 0xff]);
  });
});
