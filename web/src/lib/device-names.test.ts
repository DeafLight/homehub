import { describe, expect, it } from 'vitest';
import { readableModel, systemName } from './device-names.ts';

describe('nom lisible d’un téléphone', () => {
  it('marque et nom commercial des modèles connus', () => {
    expect(readableModel('SM-S918B')).toBe('Samsung Galaxy S23 Ultra');
    expect(readableModel('SM-A556B')).toBe('Samsung Galaxy A55 5G');
    expect(readableModel('SM-X999Z')).toBe('Samsung SM-X999Z');
    expect(readableModel('Pixel 8 Pro')).toBe('Google Pixel 8 Pro');
    expect(readableModel('RMX3771')).toBe('Realme RMX3771');
    expect(readableModel('Redmi Note 13')).toBe('Xiaomi Redmi Note 13');
  });

  it('un nom choisi ou inconnu reste tel quel', () => {
    expect(readableModel('Pixel de Léa')).toBe('Pixel de Léa');
    expect(readableModel('Téléphone de Tom')).toBe('Téléphone de Tom');
    expect(readableModel('iPhone')).toBe('iPhone');
  });

  it('système : version de Chrome, ou de Safari sur iPhone ; jamais le « Android 10 » figé', () => {
    const android = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
    expect(systemName(android, 'Android', '15.0.0')).toBe('Android 15');
    expect(systemName(android)).toBeNull();
    expect(systemName(iphone)).toBe('iOS 26');
  });
});
