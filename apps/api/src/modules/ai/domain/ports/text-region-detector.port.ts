import { NormalizedBox } from "../normalized-box";

/**
 * One word the OCR located, with its box in normalized 0..1 coordinates.
 *
 * `text` is deliberately NOT trusted as a transcription. The statement and its
 * formulas come from the vision model; what this port contributes is GEOMETRY.
 * OCR mangling `1/2` into `1 2` costs nothing here, because only the box is
 * used — except for one case: the alternative markers `A)`, `B)`, `C)` are
 * isolated glyphs that even a poor OCR reads correctly, and their positions are
 * what attributes a figure to its alternative.
 */
export interface TextWord {
  readonly text: string;
  readonly box: NormalizedBox;
  /**
   * 0..100 as tesseract reports it.
   *
   * Informational only — callers do NOT filter on it. Every implementation
   * MUST have applied its own confidence floor before returning, because a
   * low-confidence box is the dangerous direction: `findFigureRegions` erases
   * every box it is handed, so a phantom word mutilates the figure
   * underneath it and the teacher never sees why. A real word left unerased
   * only widens a crop, which the teacher can adjust. See
   * `MIN_WORD_CONFIDENCE` in `TesseractCliAdapter`.
   */
  readonly confidence: number;
}

/**
 * Locates the text in a photographed question, so whatever ink is left over
 * can be treated as its figure (design doc §3). Never reads the question.
 */
export interface TextRegionDetectorPort {
  detect(image: Buffer, mimeType: string): Promise<readonly TextWord[]>;
}
