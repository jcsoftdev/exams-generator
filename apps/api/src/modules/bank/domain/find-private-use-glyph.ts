/** The Basic Multilingual Plane's private-use area. */
const PRIVATE_USE_START = 0xe000;
const PRIVATE_USE_END = 0xf8ff;

/**
 * Returns the first private-use codepoint in `text` (as `U+XXXX`), or
 * `undefined` when there is none.
 *
 * Scraped statements occasionally carry legacy Symbol-font positions —
 * the font's byte `0xNN` copied out as `U+F0NN` — because the source
 * document typed its maths in the Symbol font instead of Unicode. No real
 * font ships glyphs in that range, so the printed exam shows a row of tofu
 * boxes where `∠`, `π` or `∩` belonged.
 *
 * They are deliberately DETECTED rather than translated. Some positions are
 * unambiguous, but several are not: `U+F03C` appears where the sentence
 * plainly means `∠` while the standard Adobe Symbol table calls it `<`, and
 * `U+F0BE` turns up mid-prose in a philosophy question where no
 * mathematical symbol fits at all. Guessing there would trade a visibly
 * broken glyph for a silently wrong question — the worse of the two, and
 * the exact failure mode `escape-typst-text.ts` exists to prevent. The
 * affected questions are quarantined instead; they are 0.06% of the bank.
 */
export function findPrivateUseGlyph(text: string): string | undefined {
  // Iterating the string (not indexing it) yields whole codepoints, so a
  // surrogate pair such as `𝜋` is never mistaken for two lone halves.
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint >= PRIVATE_USE_START && codePoint <= PRIVATE_USE_END) {
      return `U+${codePoint.toString(16).toUpperCase()}`;
    }
  }
  return undefined;
}
