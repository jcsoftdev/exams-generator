/**
 * Matches typst's `input.typ:LINE:COL` location reference in a compile
 * error's stderr output.
 */
const INPUT_LINE_REFERENCE = /input\.typ:(\d+):\d+/;

/** Matches a `// q:{id}` marker line emitted by `typst-template.ts`. */
const QUESTION_MARKER = /\/\/ q:(\S+)/;

/**
 * Traces a `typst compile` failure back to the question responsible for it.
 *
 * Strategy: find the 1-based line number typst reported, then scan
 * `typstSource` backwards from that line for the nearest preceding
 * `// q:{id}` marker — that marker is emitted immediately before the
 * question's image() block, so it identifies which question's asset the
 * failing line belongs to.
 *
 * Returns `undefined` when stderr has no traceable line reference, or when
 * the failing line precedes every marker (e.g. a syntax error in the
 * template shell itself, not attributable to any single question).
 */
export function mapCompileErrorToQuestionId(typstSource: string, stderr: string): string | undefined {
  const match = INPUT_LINE_REFERENCE.exec(stderr);
  if (!match) {
    return undefined;
  }

  const errorLine = Number(match[1]);
  const lines = typstSource.split("\n");

  for (let i = Math.min(errorLine, lines.length) - 1; i >= 0; i--) {
    const markerMatch = QUESTION_MARKER.exec(lines[i]);
    if (markerMatch) {
      return markerMatch[1];
    }
  }

  return undefined;
}
