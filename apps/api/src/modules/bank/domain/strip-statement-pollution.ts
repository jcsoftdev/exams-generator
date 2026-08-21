/**
 * The scrape of a "términos excluidos" page glued the PREVIOUS exercise's
 * option list and solution onto the next question's statement, 67 times:
 *
 *   FÚTBOL
 *   Texto:
 *   A) palabra B) frase C) inferencia D) oración E) párrafo
 *   SOLUCIÓN: Se denomina texto al enunciado… Rpta. C
 *
 * The question itself is intact — base word FÚTBOL, alternatives arquero /
 * zaguero / delantero / futbolista / portero — so the fix is to cut the bleed,
 * not to touch anything else. The signature is deliberately the whole thing
 * (`Texto:` immediately followed by that option block): a reading-comprehension
 * question may legitimately begin "Texto:" and must survive.
 */
const EXCLUDED_TERM_BLEED = /\n?\s*Texto\s*:\s*(\\?\n|\s)*A\)\s*palabra\b/i;

/**
 * A marker sitting at the very END of a statement, which is where a pasted
 * solution lands. Only trailing: the same word mid-sentence is a different
 * defect (see `INJECTED_SOLUCIONARIO`) and cutting there would truncate the
 * question.
 */
const TRAILING_SOLUTION = /\s*(\bSolucionario\b|\bSOLUCI(Ó|O)N\s*:[\s\S]*|\bRpta\b[\s\S]*)\s*$/;

/**
 * "…pero en sus Solucionario cerebros queda el rechazo…" — the scrape dropped
 * the word INTO a sentence. Recognised by its lowercase surroundings: a
 * sentence never resumes in lowercase after a real heading, so this cannot hit
 * a statement that genuinely announces its solucionario.
 */
const INJECTED_SOLUCIONARIO = /(?<=\p{Ll}\s)Solucionario\s+(?=[\p{Ll},;.])/gu;

/**
 * Cleans a scraped STATEMENT of the source page's own solution (audit
 * 2026-08-20, H8).
 *
 * Separate from `stripSolutionTail`, which cleans ALTERNATIVES, because the
 * failure modes are different: an alternative is short and its tail is always
 * at the end, while a statement can carry a whole foreign block at the front,
 * a word injected mid-sentence, or a legitimate mention ("la Resolución 217 –
 * A de la Asamblea General", "el pacto colectivo 2014 y la resolución 477")
 * that must survive untouched. Every rule here is anchored tightly enough to
 * leave those alone.
 *
 * Returns the input unchanged when a rule would empty it — a question with no
 * statement left is a data problem to look at, not something to silently blank.
 */
export function stripStatementPollution(bodyTypst: string): string {
  let cleaned = bodyTypst;

  const bleed = EXCLUDED_TERM_BLEED.exec(cleaned);
  if (bleed !== null) {
    cleaned = cleaned.slice(0, bleed.index);
  }

  cleaned = cleaned.replace(INJECTED_SOLUCIONARIO, "");
  cleaned = cleaned.replace(TRAILING_SOLUTION, "");

  const trimmed = cleaned.trim();
  return trimmed.length > 0 ? trimmed : bodyTypst;
}
