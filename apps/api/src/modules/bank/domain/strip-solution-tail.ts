/**
 * Anchors that mark where a scraped alternative stops being the alternative
 * and starts being the source page's answer key, solucionario, or navigation
 * chrome (audit 2026-08-20, H2). Measured over the bank: 120 of 65 387
 * questions carry one, and the common case is the WORST one — the last
 * option ending in `Rpta.: "C"`, printing the answer on the student's exam.
 *
 * Each pattern demands more than the bare word, because the bare words are
 * ordinary Spanish: "clave" needs its colon/period (so "una tecla de clave
 * numérica" survives), and `RESOLUCIÓN` is matched only in caps (so the UN's
 * "Resolución 217 – A" survives). The cut is anchored at the FIRST match, so
 * a tail with several markers goes in one piece.
 */
const SOLUTION_TAIL_ANCHORS: readonly RegExp[] = [
  /\bRpta\b/i,
  /\bClaves?\s*-\s*Respuestas\b/i,
  /\bClave\s*[:.]/i,
  /\bKey\s*:/,
  /\bSolucionario\b/i,
  /\bSOLUCI(Ó|O)N\s*:/,
  // One or two digits only: "Resolución 1 De acuerdo al texto…" is a numbered
  // solution step, "Resolución 217 – A" is the document the question is about.
  /\bResoluci(ó|o)n\s*\d{1,2}(?!\d)/i,
  /\bVer respuesta correcta\b/i,
  // "…no cumple Respuesta C 31. Si el esquema…" — the key, followed by the
  // next question bleeding in. One capital letter alone: "respuesta Correcta"
  // and "respuesta Ana" are prose.
  /\bRespuesta\s+[A-E]\b(?![a-záéíóúñ])/,
  /\bLee(r)?\s+(la\s+)?explicaci(ó|o)n breve\b/i,
  // Source footer the harvest glued on: "15 2da. Prueba Examen de Admisión 2020-1".
  /\b\d+\s*(da|ra|ta|va|ma)\.?\s*Prueba\b/i,
];

/**
 * Returns the alternative without the solution tail a scrape left glued to it.
 *
 * Returns the input UNCHANGED when no anchor matches, and — deliberately —
 * also when cutting would leave nothing: an option that is nothing but its own
 * answer key is a data problem to look at, and a blank option on a printed
 * exam is worse than a visible tail.
 */
export function stripSolutionTail(text: string): string {
  let cut = text.length;

  for (const anchor of SOLUTION_TAIL_ANCHORS) {
    const match = anchor.exec(text);
    if (match !== null && match.index < cut) {
      cut = match.index;
    }
  }

  if (cut === text.length) {
    return text;
  }

  const head = trimDanglingPunctuation(text.slice(0, cut));
  return head.length > 0 ? head : text;
}

/**
 * Drops a space-detached trailing separator ("El héroe discreto ." → "El héroe
 * discreto") while keeping punctuation that belongs to the sentence ("Corea del
 * Norte." stays as it is).
 */
function trimDanglingPunctuation(head: string): string {
  const trimmed = head.trimEnd();
  return /\s[.,;:–—-]$/.test(trimmed) ? trimmed.slice(0, -1).trimEnd() : trimmed;
}
