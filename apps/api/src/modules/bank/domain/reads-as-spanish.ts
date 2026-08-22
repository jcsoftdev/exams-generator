/**
 * Whether a question's statement reads as Spanish.
 *
 * The bank is shown to students sitting their exam in Spanish, so a statement
 * left in English or French is unusable to them — with one exception, which
 * this function does NOT know about and the caller must apply: in an
 * English-teaching course, an English statement is the whole point.
 *
 * The signal is short function words, which is what actually separates the
 * languages; content words drift across them (a Spanish chemistry statement is
 * full of English-looking nouns). A single loanword therefore cannot trip it:
 * it takes two foreign markers AND more foreign than Spanish ones.
 *
 * Deliberately conservative. A missed foreign statement is one bad question in
 * a bank of 65k; a false positive archives a good one.
 */
const FOREIGN_MARKERS = [
  // English function words and exam phrasing
  " the ",
  " which ",
  " of the ",
  " is the ",
  " are ",
  " what is ",
  " find the ",
  " calculate the ",
  " following ",
  " if the ",
  " there is ",
  " has been ",
  // French
  " quelle ",
  " quelles ",
  " est ",
  " sont ",
  " dans ",
  " soit ",
  " les ",
  " avec ",
  " pour ",
  " vrai ",
  " faux ",
  " une fonction ",
];

const SPANISH_MARKERS = [
  " el ",
  " la ",
  " los ",
  " las ",
  " de ",
  " que ",
  " en ",
  " un ",
  " una ",
  " halle",
  " calcule",
  " determine",
  " cuál",
  " cuánto",
  " si ",
  " señale",
  " siguiente",
  " es ",
  " del ",
  " se ",
];

function countMarkers(text: string, markers: readonly string[]): number {
  const haystack = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  return markers.reduce((total, marker) => total + (haystack.includes(marker) ? 1 : 0), 0);
}

export function readsAsSpanish(statement: string): boolean {
  const foreign = countMarkers(statement, FOREIGN_MARKERS);
  if (foreign < 2) {
    return true;
  }
  return foreign <= countMarkers(statement, SPANISH_MARKERS);
}
