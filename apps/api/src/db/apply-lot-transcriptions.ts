import { planImageLotRestructure } from "./plan-image-lot-restructure";
import { LotEntry } from "./plan-lot-seed";

/**
 * One baked crop, read back by hand.
 *
 * `imagePath` is the join key — it is what identifies a question inside a
 * lot, unique by construction (`build_lot.py` names each PNG after the
 * course, lot and question number).
 */
/**
 * The figure's rectangle inside the whole-question crop, as FRACTIONS of the
 * source image (0 = left/top edge, 1 = right/bottom edge).
 *
 * Fractions rather than pixels because the reader is looking at the PNG
 * scaled to fit, and has no reliable sense of its pixel dimensions — a
 * fraction is what they can actually judge, and it survives a re-render of
 * the source at a different DPI.
 */
export interface FigureCropBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A crop the I/O shell has to perform, since this module never opens a file. */
export interface FigureCropJob {
  readonly source: string;
  readonly target: string;
  readonly box: FigureCropBox;
}

export interface LotTranscription {
  readonly imagePath: string;
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
  readonly figureCode?: string | null;
  /**
   * Where the figure sits inside the crop, when the question keeps one. The
   * whole-question crop is never reused as the complement: it would reprint
   * the statement along with the source's numbering and lettering.
   */
  readonly figureCrop?: FigureCropBox;
  /**
   * Where each alternative's drawing sits inside the crop, `null` for a slot
   * whose option is ordinary text. A sequence question offers five pictures
   * and no words; the exam then prints its OWN `A)`-`E)` beside them instead
   * of the source's lowercase lettering.
   */
  readonly alternativeCrops?: readonly (FigureCropBox | null)[];
  /** Why this crop cannot become text — set instead of the fields above. */
  readonly unreadable?: string;
}

export interface ApplyLotTranscriptionsInput {
  readonly imageEntries: readonly LotEntry[];
  readonly structuredEntries: readonly LotEntry[];
  readonly transcriptions: readonly LotTranscription[];
}

export interface ApplyLotTranscriptionsResult {
  readonly structuredEntries: readonly LotEntry[];
  readonly imageEntries: readonly LotEntry[];
  /** One line per crop that stayed an image because something was wrong with it. */
  readonly reasons: readonly string[];
  /** Transcriptions naming a crop this lot does not have pending. */
  readonly unmatched: readonly string[];
  /** Crops to cut before the lot is seeded — see `FigureCropJob`. */
  readonly figureCrops: readonly FigureCropJob[];
}

/**
 * `lot-x-image/alg-1.png` -> `lot-x-figures/alg-1.png`, mirroring the
 * `<lot>-figures/` directory `tools/harvest/build_lot.py` already writes when
 * it crops a figure out of a PDF.
 */
function figureTargetFor(imagePath: string): string {
  return imagePath.replace(/-image\//, "-figures/");
}

/** `lot-x-image/alg-1.png`, slot 1 -> `lot-x-alternatives/alg-1-b.png`. */
function alternativeTargetFor(imagePath: string, index: number): string {
  const letter = ALTERNATIVE_LETTERS[index] ?? String(index + 1);

  return imagePath.replace(/-image\//, "-alternatives/").replace(/\.png$/i, `-${letter}.png`);
}

const ALTERNATIVE_LETTERS = ["a", "b", "c", "d", "e"] as const;

function assertBoxInsideImage(box: FigureCropBox, imagePath: string): void {
  const ordered = box.left < box.right && box.top < box.bottom;
  const bounded = [box.left, box.top, box.right, box.bottom].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
  if (!ordered || !bounded) {
    throw new Error(
      `figureCrop for ${imagePath} is not a rectangle inside the image: ${JSON.stringify(box)}`,
    );
  }
}

/**
 * Folds a batch of hand-read crops back into one harvested lot.
 *
 * The reading is done by whoever can actually see the PNG — this repository's
 * own agent session, not a paid vision endpoint — so this half stays a pure
 * function over data: it never opens an image, never calls a provider, and is
 * therefore testable without either.
 *
 * A crop nobody transcribed is left exactly where it was, which is what makes
 * the work resumable: export a batch, read it, apply it, repeat. Re-applying
 * the same file is a no-op that reports its entries as `unmatched`, because
 * by then they are no longer pending.
 */
export function applyLotTranscriptions(
  input: ApplyLotTranscriptionsInput,
): ApplyLotTranscriptionsResult {
  const byImagePath = new Map<string, LotTranscription>();
  for (const transcription of input.transcriptions) {
    if (byImagePath.has(transcription.imagePath)) {
      // Two readings of one crop means the batch was merged wrongly. Picking
      // either silently would bake a coin flip into the bank.
      throw new Error(`two transcriptions claim the same crop: ${transcription.imagePath}`);
    }
    byImagePath.set(transcription.imagePath, transcription);
  }

  const structuredEntries = [...input.structuredEntries];
  const imageEntries: LotEntry[] = [];
  const reasons: string[] = [];
  const figureCrops: FigureCropJob[] = [];
  const matched = new Set<string>();

  for (const entry of input.imageEntries) {
    const transcription = entry.imagePath ? byImagePath.get(entry.imagePath) : undefined;
    if (!transcription) {
      imageEntries.push(entry);
      continue;
    }
    matched.add(transcription.imagePath);

    if (transcription.unreadable) {
      imageEntries.push(entry);
      reasons.push(`${entry.sourceName}: ${transcription.unreadable}`);
      continue;
    }

    // A redrawn figure makes the raster redundant, so the crop is not even
    // requested — and a rejected transcription must not leave a cut file
    // behind that nothing references.
    const wantsCrop = Boolean(transcription.figureCrop) && !transcription.figureCode;
    if (transcription.figureCrop) {
      assertBoxInsideImage(transcription.figureCrop, transcription.imagePath);
    }
    const target = wantsCrop ? figureTargetFor(transcription.imagePath) : undefined;

    const alternativeCrops = transcription.alternativeCrops;
    alternativeCrops?.forEach((box) => {
      if (box) {
        assertBoxInsideImage(box, transcription.imagePath);
      }
    });
    const alternativeImagePaths = alternativeCrops?.map((box, index) =>
      box ? alternativeTargetFor(transcription.imagePath, index) : null,
    );

    const outcome = planImageLotRestructure({
      entry,
      extracted: {
        bodyTypst: transcription.bodyTypst ?? "",
        alternatives: transcription.alternatives ?? [],
        ...(transcription.figureCode ? { figureCode: transcription.figureCode } : {}),
        ...(target ? { figureImagePath: target } : {}),
        ...(alternativeImagePaths ? { alternativeImagePaths } : {}),
      },
    });

    if (outcome.kind === "structured") {
      structuredEntries.push(outcome.entry);
      if (target && transcription.figureCrop) {
        figureCrops.push({ source: transcription.imagePath, target, box: transcription.figureCrop });
      }
      alternativeCrops?.forEach((box, index) => {
        const alternativeTarget = alternativeImagePaths?.[index];
        if (box && alternativeTarget) {
          figureCrops.push({ source: transcription.imagePath, target: alternativeTarget, box });
        }
      });
    } else {
      imageEntries.push(entry);
      reasons.push(`${entry.sourceName}: ${outcome.reason}`);
    }
  }

  return {
    structuredEntries,
    imageEntries,
    reasons,
    unmatched: input.transcriptions
      .map((transcription) => transcription.imagePath)
      .filter((imagePath) => !matched.has(imagePath)),
    figureCrops,
  };
}
