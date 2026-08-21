/** Cono, cilindro, esfera — the bodies "Cuerpos Redondos" is about. */
const ROUND_SOLID = /\b(cono|conos|cilindro|cilindros|esfera|esferas)\b/i;

/**
 * What makes the solid the SUBJECT rather than scenery: the question asks for
 * a volume or a surface. Without this the rule swallows a projectile problem
 * ("dos esferas saliendo de una mesa… calcula la altura"), which is physics
 * wearing a sphere, not solid geometry.
 */
const SOLID_MEASURE = /\b(volumen|volúmenes|volumenes|área lateral|area lateral|superficie lateral)\b/i;

/**
 * True when a statement is a solid-of-revolution problem — the signature of a
 * question filed under a PLANE topic that belongs in "Cuerpos Redondos"
 * (audit 2026-08-20, M12).
 *
 * Deliberately narrow. Measuring the bank showed the noise in that finding is
 * far smaller than a keyword sweep suggests: of 317 questions under
 * Geometría → Triángulos, the 25 that mention sen/cos/tg are all genuine
 * triangle problems that merely USE trigonometry, and only the
 * solid-of-revolution ones are actually in the wrong topic. A rule that fires
 * on the word alone would move good questions to fix a handful of bad ones.
 */
export function isRoundSolidQuestion(bodyTypst: string): boolean {
  return ROUND_SOLID.test(bodyTypst) && SOLID_MEASURE.test(bodyTypst);
}
