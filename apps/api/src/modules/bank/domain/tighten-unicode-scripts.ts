/**
 * Superscript and subscript characters, as Unicode spells them: the three
 * legacy Latin-1 exponents (`²³¹`), the `⁰⁴-⁹⁺⁻⁼⁽⁾ⁿⁱ` block, and the whole
 * subscript block including its letter forms.
 */
const SCRIPT_CHARACTER = "\\u00B2\\u00B3\\u00B9\\u2070-\\u207F\\u2080-\\u209C";

/**
 * Horizontal whitespace that follows a visible character and precedes a
 * script. `\n` is deliberately excluded — a script opening a line belongs to
 * that line, and pulling it back would splice two equations into one.
 */
const STRANDED_SCRIPT = new RegExp(`(\\S)[ \\t]+(?=[${SCRIPT_CHARACTER}])`, "gu");

/**
 * Closes the gap a scrape opened between an exponent and the base it belongs
 * to: `2m/s ²` becomes `2m/s²`, and `) ¹ ⁵` becomes `)¹⁵`.
 *
 * These are OCR artefacts, not notation. Roughly 1300 collected statements
 * carry them, and they read as broken in both directions — the web preview
 * shows the drifting glyph, and Typst prints the same drift into the exam,
 * because a script character is ordinary text to both. Nothing here changes
 * meaning: only horizontal whitespace is removed, and only where a script
 * character sits on the far side of it.
 *
 * The space AFTER a script is kept on purpose. In `3x ³ y` that space
 * separates two factors, so tightening it would fuse `y` onto the exponent
 * and read as a different expression.
 */
export function tightenUnicodeScripts(raw: string): string {
  return raw.replace(STRANDED_SCRIPT, "$1");
}
