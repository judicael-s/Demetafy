import { describe, it, expect } from 'vitest';
import { fixMojibake } from './encoding.js';

describe('fixMojibake', () => {
  describe('representative mojibake patterns from Meta DYI archives', () => {
    it('decodes accented French chars (é, ç) from DM bodies', () => {
      expect(fixMojibake('aimÃ©')).toBe('aimé');
      expect(fixMojibake('faire Ã§a')).toBe('faire ça');
    });

    it('decodes curly apostrophes and em-dashes from captions', () => {
      expect(fixMojibake('Letâs')).toBe('Let’s');
      expect(fixMojibake('ouiâa')).toBe('oui—a');
    });

    it('decodes emoji encoded as 4 Latin-1 escapes', () => {
      // 🚨 = U+1F6A8, UTF-8 = F0 9F 9A A8
      expect(fixMojibake('ð¨')).toBe('\u{1F6A8}');
    });

    it('decodes multi-codepoint emoji sequences (heart + VS16)', () => {
      // ❤️ = U+2764 U+FE0F, UTF-8 = E2 9D A4 EF B8 8F
      expect(fixMojibake('â¤ï¸')).toBe('❤️');
    });

    it('handles full sentences mixing ASCII with mojibake', () => {
      const input =
        "Bonjour, je voudrais quelques renseignements. " +
        "J'aurais aimÃ© savoir si c'est encore possible";
      const expected =
        "Bonjour, je voudrais quelques renseignements. " +
        "J'aurais aimé savoir si c'est encore possible";
      expect(fixMojibake(input)).toBe(expected);
    });
  });

  describe('idempotency / safety', () => {
    it('leaves already-decoded text unchanged', () => {
      expect(fixMojibake('aimé')).toBe('aimé');
      expect(fixMojibake('Hello world')).toBe('Hello world');
      expect(fixMojibake('\u{1F6A8}')).toBe('\u{1F6A8}'); // already-decoded 🚨
      expect(fixMojibake('')).toBe('');
    });

    it('leaves pure ASCII unchanged', () => {
      expect(fixMojibake('https://www.instagram.com/reel/ABC123/')).toBe(
        'https://www.instagram.com/reel/ABC123/',
      );
    });

    it('does not corrupt strings whose bytes are not valid UTF-8', () => {
      // Lone continuation byte 0x80 alone is invalid UTF-8 — must return original.
      expect(fixMojibake('')).toBe('');
    });
  });
});
