/**
 * Reverse the Latin-1-over-UTF-8 mojibake Meta emits in DYI JSON exports.
 *
 * Meta serializes each byte of a UTF-8 string as its own `\u00XX` JSON escape, so
 * `"é"` (U+00E9, UTF-8 bytes 0xC3 0xA9) arrives in the parsed JSON as the two-
 * codepoint string `"Ã©"`. Across emoji, em-dashes, and accented chars,
 * every line of user-authored text looks like garbled Latin-1 until decoded.
 *
 * Fix: treat each parsed codepoint as a single Latin-1 byte, reassemble the byte
 * sequence, and decode it as UTF-8. CLAUDE.md gotcha #1; #1 archive-parser bug in
 * the wild. Confirmed in Alex' archive 2026-05-19.
 */
export function fixMojibake(text: string): string {
  // Any codepoint above 0xFF means the string can't be reinterpreted as Latin-1
  // bytes — either it's already clean, or it contains non-mojibake content we
  // shouldn't corrupt. Bail out unchanged (idempotency).
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0xff) return text;
  }

  // Uint8Array (not Buffer) so the parser stays portable to the WebView, where
  // Node's Buffer global doesn't exist. TextDecoder accepts it identically.
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Invalid UTF-8 — the string wasn't mojibake'd; return as-is.
    return text;
  }
}
