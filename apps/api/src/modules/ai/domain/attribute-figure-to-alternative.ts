import { NormalizedBox } from "./normalized-box";
import { TextWord } from "./ports/text-region-detector.port";

export interface AttributedFigure {
  readonly alternativeIndex: number;
  readonly box: NormalizedBox;
}

export interface AttributedFigures {
  /** The statement's own figure: the one above the first alternative marker. */
  readonly complement?: NormalizedBox;
  readonly byAlternative: readonly AttributedFigure[];
}

/** `a)`, `B.`, `c:` — a single letter a..e followed by one separator, alone in its box. */
const ALTERNATIVE_MARKER = /^([a-e])\s*[).:]$/i;

/**
 * Decides which alternative each figure belongs to, from geometry alone.
 *
 * The alternative markers split the page into bands: C)'s band runs from its
 * own top down to D)'s top. A figure whose vertical centre falls in that band
 * is C's drawing; a figure above the first marker is the statement's
 * complement.
 *
 * This replaces the `alternativeIndex` the vision model used to report. The
 * model was guessing; the page's own layout is not.
 *
 * With no marker recognised — a crooked photo, an OCR that missed them — every
 * figure is treated as complement. That is the safe degradation: the
 * complement is the common case, and the teacher reviews the crop before it is
 * ever saved.
 */
export function attributeFigureToAlternative(
  figures: readonly NormalizedBox[],
  words: readonly TextWord[],
): AttributedFigures {
  const markers = findMarkers(words);

  if (markers.length === 0) {
    return { ...(figures.length > 0 ? { complement: figures[0] } : {}), byAlternative: [] };
  }

  const firstMarkerTop = markers[0]!.top;
  const byAlternative: AttributedFigure[] = [];
  let complement: NormalizedBox | undefined;

  for (const box of figures) {
    const centre = box.y + box.h / 2;

    if (centre < firstMarkerTop) {
      // Only the topmost one: a question has a single complement figure, and a
      // second blob up there is noise rather than a second drawing.
      complement ??= box;
      continue;
    }

    const owner = [...markers].reverse().find((marker) => centre >= marker.top);
    if (owner) {
      byAlternative.push({ alternativeIndex: owner.index, box });
    }
  }

  return { ...(complement ? { complement } : {}), byAlternative };
}

/**
 * The first vertical occurrence of each letter a..e, in reading order.
 *
 * First occurrence only: the same letter shows up again inside the answers'
 * own text ("A) el conjunto A"), and a later match would carve a band where
 * there is none.
 */
function findMarkers(words: readonly TextWord[]): { index: number; top: number }[] {
  const topByLetter = new Map<string, number>();

  for (const word of [...words].sort((a, b) => a.box.y - b.box.y)) {
    const match = word.text.trim().match(ALTERNATIVE_MARKER);
    if (!match) {
      continue;
    }
    const letter = match[1]!.toLowerCase();
    if (!topByLetter.has(letter)) {
      topByLetter.set(letter, word.box.y);
    }
  }

  return [...topByLetter.entries()]
    .map(([letter, top]) => ({ index: letter.charCodeAt(0) - "a".charCodeAt(0), top }))
    .sort((a, b) => a.top - b.top);
}
