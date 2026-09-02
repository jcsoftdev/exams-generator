import { attributeFigureToAlternative } from "./attribute-figure-to-alternative";
import { TextWord } from "./ports/text-region-detector.port";

function marker(text: string, y: number): TextWord {
  return { text, box: { x: 0.05, y, w: 0.04, h: 0.03 }, confidence: 95 };
}

function figure(y: number): { x: number; y: number; w: number; h: number } {
  return { x: 0.3, y, w: 0.2, h: 0.08 };
}

/** Markers at 0.50, 0.60, 0.70, 0.80, 0.90 — the alternatives block of a page. */
const MARKERS = [
  marker("A)", 0.5),
  marker("B)", 0.6),
  marker("C)", 0.7),
  marker("D)", 0.8),
  marker("E)", 0.9),
];

describe("attributeFigureToAlternative", () => {
  it("MUST: a figure inside C)'s band belongs to alternative index 2", () => {
    const result = attributeFigureToAlternative([figure(0.72)], MARKERS);

    expect(result.byAlternative).toEqual([{ alternativeIndex: 2, box: figure(0.72) }]);
    expect(result.complement).toBeUndefined();
  });

  it("MUST: a figure whose centre lands exactly on a marker's top belongs to THAT alternative, not the one above", () => {
    // y=0.69, h=0.02 gives a centre of EXACTLY 0.7 in IEEE 754 double
    // arithmetic (0.66 + 0.08/2 does not: it lands on 0.7000000000000001,
    // which would pass this assertion for the wrong reason). The band is
    // [own top, next top), so a centre equal to C)'s top is C's, not B's.
    const onCsTop = { x: 0.3, y: 0.69, w: 0.2, h: 0.02 };

    const result = attributeFigureToAlternative([onCsTop], MARKERS);

    expect(result.byAlternative).toEqual([{ alternativeIndex: 2, box: onCsTop }]);
  });

  it("MUST: a figure above the first marker is the statement's complement", () => {
    const result = attributeFigureToAlternative([figure(0.2)], MARKERS);

    expect(result.complement).toEqual(figure(0.2));
    expect(result.byAlternative).toEqual([]);
  });

  it("splits several figures across their own alternatives", () => {
    const result = attributeFigureToAlternative([figure(0.52), figure(0.82)], MARKERS);

    expect(result.byAlternative.map((entry) => entry.alternativeIndex)).toEqual([0, 3]);
  });

  it("accepts the other marker punctuations a printed exam uses", () => {
    const dotted = [marker("a.", 0.5), marker("b.", 0.6), marker("c.", 0.7)];

    const result = attributeFigureToAlternative([figure(0.72)], dotted);

    expect(result.byAlternative).toEqual([{ alternativeIndex: 2, box: figure(0.72) }]);
  });

  it("with no marker recognised, every figure is complement — the common case degrading safely", () => {
    const result = attributeFigureToAlternative([figure(0.72)], [marker("Hola", 0.5)]);

    expect(result.complement).toEqual(figure(0.72));
    expect(result.byAlternative).toEqual([]);
  });

  it("keeps only the FIRST occurrence of a letter — the letter also appears inside the answers' text", () => {
    const noisy = [...MARKERS, marker("A)", 0.95)];

    const result = attributeFigureToAlternative([figure(0.96)], noisy);

    // 0.96 is below E)'s marker at 0.90, so it belongs to E (index 4), not to
    // the stray "A)" the OCR also found down there.
    expect(result.byAlternative).toEqual([{ alternativeIndex: 4, box: figure(0.96) }]);
  });

  it("MUST: takes at most one figure per alternative — a detached label is not a second drawing", () => {
    // Two blobs inside C)'s band: the drawing and the loose label or arrow
    // beside it that never touched it. The contract downstream is one crop
    // slot per entry, so a duplicated index shows the teacher two slots both
    // labelled C), both pointing at the same alternative.
    const drawing = { x: 0.3, y: 0.71, w: 0.2, h: 0.04 };
    const detachedLabel = { x: 0.6, y: 0.75, w: 0.05, h: 0.03 };

    const result = attributeFigureToAlternative([drawing, detachedLabel], MARKERS);

    expect(result.byAlternative).toEqual([{ alternativeIndex: 2, box: drawing }]);
  });

  it("MUST: keeps the TOPMOST figure of a band, mirroring the complement rule", () => {
    // `findFigureRegions` returns figures top-to-bottom, so the first entry
    // in a band is its topmost one — the drawing, with the stray ink below it.
    const topmost = { x: 0.3, y: 0.71, w: 0.2, h: 0.04 };
    const below = { x: 0.3, y: 0.76, w: 0.2, h: 0.03 };

    const result = attributeFigureToAlternative([topmost, below], MARKERS);

    expect(result.byAlternative).toHaveLength(1);
    expect(result.byAlternative[0]!.box).toEqual(topmost);
  });

  it("still keeps one figure per DISTINCT alternative when several bands have one", () => {
    const inA = { x: 0.3, y: 0.51, w: 0.2, h: 0.04 };
    const alsoInA = { x: 0.6, y: 0.55, w: 0.05, h: 0.03 };
    const inD = { x: 0.3, y: 0.81, w: 0.2, h: 0.04 };

    const result = attributeFigureToAlternative([inA, alsoInA, inD], MARKERS);

    expect(result.byAlternative).toEqual([
      { alternativeIndex: 0, box: inA },
      { alternativeIndex: 3, box: inD },
    ]);
  });

  it("takes at most one complement — a second figure above the markers is dropped, not stacked", () => {
    const result = attributeFigureToAlternative([figure(0.1), figure(0.2)], MARKERS);

    expect(result.complement).toEqual(figure(0.1));
    expect(result.byAlternative).toEqual([]);
  });
});
