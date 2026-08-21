/**
 * `"Copia de X"`, then `"Copia de X (2)"`, `"(3)"`… — never
 * `"Copia de Copia de X"`.
 *
 * Duplicating used to prepend "Copia de " unconditionally, so a teacher who
 * used the same exam as a template four times ended up with "Copia de Copia de
 * Copia de Copia de Examen 4to secundaria" filling the list, four rows with the
 * title clipped at the same point and no way to tell them apart (audit
 * 2026-08-20, L7).
 *
 * A title that is ALREADY a copy keeps its base and takes the next free
 * number: the copy of a copy is another copy of the same exam, not a
 * second-generation thing anyone thinks about that way.
 */
export function duplicateTitle(originalTitle: string, existingTitles: Iterable<string>): string {
  const base = copyBaseFor(originalTitle);
  const taken = new Set([...existingTitles].map((title) => title.trim()));

  if (!taken.has(base)) {
    return base;
  }
  // Starts at 2: the unnumbered title IS the first copy.
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Trailing " (12)" — the counter this function appends.
 *
 * Three digits at most, and only stripped from a title that is already a copy.
 * Nothing distinguishes our "(2)" from a teacher's own "(2024)", so the rule
 * errs toward keeping what they typed: "Simulacro (2024)" duplicates to
 * "Copia de Simulacro (2024)" with the year intact, and only a title that
 * already says "Copia de" can lose a small parenthesised number — which is
 * ours in every realistic case.
 */
const COUNTER_SUFFIX = /\s*\(\d{1,3}\)$/;

const COPY_PREFIX = "Copia de ";

function copyBaseFor(originalTitle: string): string {
  const title = originalTitle.trim();
  if (!title.startsWith(COPY_PREFIX)) {
    return `${COPY_PREFIX}${title}`;
  }
  return title.replace(COUNTER_SUFFIX, "").trim();
}
