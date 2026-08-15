/** Markup characters that are only inert once backslash-escaped. */
const INLINE_MARKUP = new Set(["#", "$", "*", "_", "`", "@", "<", ">", "~", "[", "]"]);

/** Markup characters that only bite in first-position-on-a-line. */
const LINE_START_MARKUP = new Set(["=", "-", "+", "/"]);

/**
 * Returns the first Typst markup character in `text` that is NOT escaped, or
 * `undefined` when the text is inert.
 *
 * This is the enforcement half of `escapeTypstText` — the check that its
 * output really is safe. Compiling all 64k collected questions with the real
 * binary on every boot is not affordable (minutes of blocked startup), and
 * `escapeTypstText` was already shipped once missing a case: `/` at the start
 * of a verse line, which Typst reads as a term list and which slipped through
 * to a failing exam. A cheap structural check that runs on every ingested
 * entry turns the NEXT such gap into a seeder log line instead of a broken
 * PDF weeks later.
 */
export function findUnescapedTypstMarkup(text: string): string | undefined {
  for (const line of text.split("\n")) {
    let index = 0;
    // A line's leading whitespace does not consume its "start" position:
    // Typst still reads `  - item` as a list item.
    let atLineStart = true;

    while (index < line.length) {
      const character = line[index]!;

      if (character === "\\") {
        // The escape consumes whatever follows it, including another
        // backslash — so `\\_` is an ESCAPED backslash followed by a BARE
        // underscore, and must still be reported.
        index += 2;
        atLineStart = false;
        continue;
      }

      if (INLINE_MARKUP.has(character) || (atLineStart && LINE_START_MARKUP.has(character))) {
        return character;
      }

      if (atLineStart && !/\s/.test(character)) {
        atLineStart = false;
      }
      index++;
    }
  }

  return undefined;
}
