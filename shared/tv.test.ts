// Tests du nettoyage d'un message à la télé : espaces et retours à la ligne aplatis, caractères invisibles et
// chevrons retirés, emojis gardés et comptés pour un, limite de longueur.
import { describe, expect, it } from 'vitest';
import { cleanTvMessage, TV_MESSAGE_MAX, tvMessageLength, tvMessageValid } from './tv.ts';

describe('cleanTvMessage', () => {
  it('aplatit les retours à la ligne et les espaces répétées', () => {
    expect(cleanTvMessage('  À table !\n\n  On mange   dans 5 min\t ')).toBe('À table ! On mange dans 5 min');
  });

  it('retire les caractères de contrôle, invisibles, de sens d’écriture et les chevrons', () => {
    expect(cleanTvMessage('Bon\u0000jour\u{200B} \u{202E}à tous\u{202C} <b>vite</b>\u{FEFF}')).toBe('Bonjour à tous bvite/b');
  });

  it('normalise les accents composés (NFC)', () => {
    expect(cleanTvMessage('e\u{301}te\u{301}')).toBe('été');
  });

  it('garde les emojis, y compris composés', () => {
    expect(cleanTvMessage('Dodo 😴 👨‍👩‍👧')).toBe('Dodo 😴 👨‍👩‍👧');
  });
});

describe('tvMessageLength et tvMessageValid', () => {
  it('compte le texte nettoyé, un emoji simple pour un caractère', () => {
    expect(tvMessageLength('  Coucou 😴 \n')).toBe(8);
  });

  it('refuse un message vide ou trop long', () => {
    expect(tvMessageValid(' \n\u{200B} ')).toBe(false);
    expect(tvMessageValid('a'.repeat(TV_MESSAGE_MAX))).toBe(true);
    expect(tvMessageValid('a'.repeat(TV_MESSAGE_MAX + 1))).toBe(false);
  });
});
