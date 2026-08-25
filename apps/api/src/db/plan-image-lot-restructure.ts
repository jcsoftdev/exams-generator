import { correctAnswerLetterToIndex } from "../modules/ai/domain/correct-answer-letter-to-index";
import { validateStructuredContent } from "../modules/bank/domain/validate-structured-content";
import { LotEntry } from "./plan-lot-seed";

/**
 * What was read back off one baked question PNG.
 *
 * The reader is whoever can actually see the image — the agent session working
 * in this repository, via `restructure-image-lot.ts --export`. `correctAnswer`
 * is accepted so a reading can carry one, and then deliberately ignored: the
 * lot already knows the published key.
 */
export interface ExtractedQuestion {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly figureCode?: string;
  /**
   * A complement image ALREADY narrowed to the figure alone. The whole-question
   * crop is never a candidate: it carries the statement a second time, plus the
   * source's numbering and lettering — the very thing this pass exists to
   * remove.
   */
  readonly figureImagePath?: string;
  /** One narrowed image per alternative slot, `null` where the option is text. */
  readonly alternativeImagePaths?: readonly (string | null)[];
  readonly correctAnswer?: string;
}

export interface PlanImageLotRestructureInput {
  readonly entry: LotEntry;
  /** `undefined` when the vision call failed or returned nothing usable. */
  readonly extracted: ExtractedQuestion | undefined;
}

export type ImageLotRestructureOutcome =
  | { readonly kind: "structured"; readonly entry: LotEntry }
  | { readonly kind: "keep-image"; readonly reason: string };

/**
 * The numbering the source sheet printed ahead of the statement — "17.",
 * "06.", "43)". The extract prompt already asks the model to leave it out;
 * this strips it anyway, because when it slips through the exam prints two
 * numbers on the same question ("4. 17. Si A ⊂ R⁻ ...").
 */
/** Every admission exam these lots come from offers exactly five options. */
const SOURCE_ALTERNATIVE_COUNT = 5;

const SOURCE_NUMBERING = /^\s*\d{1,3}\s*[.)–-]\s+/;

/**
 * Decides what ONE whole-question PNG becomes once a vision pass has read it.
 *
 * The harvest's `--all-images` escape hatch baked 1542 questions into
 * screenshots of their source sheet — carrying its numbering, its lowercase
 * `a)`-`e)` lettering, its watermarks and slivers of the neighbouring
 * question into the generated exam. The bank's own model has said all along
 * what the standard is (`questions.image_asset_id` is documented as "the ONE
 * complement image"): a question is TEXT, and an image is what accompanies it
 * when the accompaniment cannot be written down.
 *
 * So the crop survives only when it still earns its place — the statement
 * refers to something drawn and the model could not redraw it as CeTZ. A
 * question whose figure came back as CeTZ needs no raster at all, and a
 * question that never referred to a figure never needed one.
 *
 * The published answer key always wins over the model's reading of it. The
 * lot's `correctAnswer` came from the solucionario; the model is guessing
 * from a picture, and a silently wrong key is the one defect a teacher
 * cannot catch by eye.
 */
export function planImageLotRestructure(
  input: PlanImageLotRestructureInput,
): ImageLotRestructureOutcome {
  const { entry, extracted } = input;

  if (!extracted) {
    return { kind: "keep-image", reason: "extraction failed" };
  }

  let correctAnswer: string;
  try {
    correctAnswer = correctAnswerLetterToIndex(entry.correctAnswer);
  } catch {
    return { kind: "keep-image", reason: `lot answer key "${entry.correctAnswer}" is not a letter a-e` };
  }

  const bodyTypst = extracted.bodyTypst.replace(SOURCE_NUMBERING, "").trim();
  const alternatives = extracted.alternatives.map((alternative) => alternative.trim());

  const alternativeImagePaths = extracted.alternativeImagePaths;
  const errors = validateStructuredContent({
    bodyTypst,
    alternatives,
    correctAnswer,
    ...(alternativeImagePaths
      ? { alternativeHasImage: alternativeImagePaths.map((path) => Boolean(path)) }
      : {}),
  });
  if (errors.length > 0) {
    return { kind: "keep-image", reason: errors.join("; ") };
  }

  // Stricter than the bank's own floor of 2 on purpose. These lots are
  // admission exams, every one of which offers five options, and a missing
  // option is the exact symptom that made `build_lot.py` bake the question
  // as a PNG in the first place. Accepting four here would launder that same
  // loss into a question a teacher cannot tell is incomplete.
  if (alternatives.length !== SOURCE_ALTERNATIVE_COUNT) {
    return {
      kind: "keep-image",
      reason: `read ${alternatives.length} alternatives, the source exam offers ${SOURCE_ALTERNATIVE_COUNT}`,
    };
  }

  const figureCode = extracted.figureCode?.trim() ? extracted.figureCode : undefined;
  // A redrawn figure wins: vector code scales, re-typesets and carries no
  // scanner artefacts, so a raster of the same drawing is dead weight.
  const complementPath = figureCode ? undefined : extracted.figureImagePath;

  return {
    kind: "structured",
    entry: {
      courseName: entry.courseName,
      topicName: entry.topicName,
      gradeLevel: entry.gradeLevel,
      difficulty: entry.difficulty,
      bodyTypst,
      alternatives,
      correctAnswer,
      ...(figureCode ? { figureCode } : {}),
      ...(alternativeImagePaths?.some(Boolean) ? { alternativeImagePaths } : {}),
      ...(complementPath ? { imagePath: complementPath } : {}),
      ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
      sourceName: entry.sourceName,
    },
  };
}
