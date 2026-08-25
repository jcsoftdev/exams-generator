import { planImageLotRestructure } from "./plan-image-lot-restructure";
import { LotEntry } from "./plan-lot-seed";

const IMAGE_ENTRY: LotEntry = {
  courseName: "Álgebra",
  topicName: "Funciones",
  gradeLevel: "pre",
  difficulty: "hard",
  correctAnswer: "c",
  imagePath: "lot-0-uni-2019-1-image/alg-lot-0-uni-2019-1-alg-02.png",
  sourceUrl: "https://admision.uni.edu.pe/solucionario2019.pdf",
  sourceName: "UNI — Examen de Admisión 2019-1, Álgebra, pregunta 2 (clave C)",
};

const EXTRACTED = {
  bodyTypst: "Si $A subset RR$ determine el conjunto $A$.",
  alternatives: ["$(-1; 2]$", "$(-3; -sqrt(5)]$", "$(-4; -2]$", "$(-2; -1]$", "$[-3; sqrt(5)]$"],
};

describe("planImageLotRestructure", () => {
  it("turns a readable extraction into a structured entry", () => {
    const result = planImageLotRestructure({ entry: IMAGE_ENTRY, extracted: EXTRACTED });

    expect(result.kind).toBe("structured");
    expect(result.kind === "structured" && result.entry.bodyTypst).toBe(EXTRACTED.bodyTypst);
    expect(result.kind === "structured" && result.entry.alternatives).toEqual(EXTRACTED.alternatives);
  });

  it("keeps the answer key the source published, never the one the model guessed", () => {
    const result = planImageLotRestructure({
      entry: IMAGE_ENTRY,
      extracted: { ...EXTRACTED, correctAnswer: "a" },
    });

    expect(result.kind === "structured" && result.entry.correctAnswer).toBe("2");
  });

  it("carries the lot's provenance onto the structured entry unchanged", () => {
    const result = planImageLotRestructure({ entry: IMAGE_ENTRY, extracted: EXTRACTED });

    expect(result.kind === "structured" && result.entry.sourceName).toBe(IMAGE_ENTRY.sourceName);
    expect(result.kind === "structured" && result.entry.courseName).toBe("Álgebra");
  });

  it("drops the crop when the model redrew the figure as CeTZ", () => {
    const result = planImageLotRestructure({
      entry: IMAGE_ENTRY,
      extracted: { ...EXTRACTED, figureCode: '#import "@preview/cetz:0.5.2": canvas, draw\n#canvas({})' },
    });

    expect(result.kind === "structured" && result.entry.imagePath).toBeUndefined();
    expect(result.kind === "structured" && result.entry.figureCode).toContain("canvas");
  });

  it("drops the crop when nothing in the statement refers to a figure", () => {
    const result = planImageLotRestructure({ entry: IMAGE_ENTRY, extracted: EXTRACTED });

    expect(result.kind === "structured" && result.entry.imagePath).toBeUndefined();
  });

  it("strips the numbering the source printed ahead of the statement", () => {
    const result = planImageLotRestructure({
      entry: IMAGE_ENTRY,
      extracted: { ...EXTRACTED, bodyTypst: "17. Si $A subset RR$ determine el conjunto $A$." },
    });

    expect(result.kind === "structured" && result.entry.bodyTypst).toBe("Si $A subset RR$ determine el conjunto $A$.");
  });

  it("stays an image question when extraction failed outright", () => {
    const result = planImageLotRestructure({ entry: IMAGE_ENTRY, extracted: undefined });

    expect(result).toEqual({ kind: "keep-image", reason: "extraction failed" });
  });

  it("stays an image question when the extraction is not printable content", () => {
    const result = planImageLotRestructure({
      entry: IMAGE_ENTRY,
      extracted: { bodyTypst: "  ", alternatives: ["a", "b", "c", "d", "e"] },
    });

    expect(result.kind).toBe("keep-image");
  });

  it("stays an image question when the model returned fewer than five alternatives", () => {
    const result = planImageLotRestructure({
      entry: IMAGE_ENTRY,
      extracted: { ...EXTRACTED, alternatives: ["1", "2", "3", "4"] },
    });

    expect(result.kind).toBe("keep-image");
  });

  it("refuses an entry whose lot answer key is not a letter it can place", () => {
    const result = planImageLotRestructure({
      entry: { ...IMAGE_ENTRY, correctAnswer: "z" },
      extracted: EXTRACTED,
    });

    expect(result.kind).toBe("keep-image");
  });

  it("keeps the narrowed figure the reader cropped, whatever the wording says", () => {
    const result = planImageLotRestructure({
      entry: IMAGE_ENTRY,
      extracted: { ...EXTRACTED, figureImagePath: "lot-0-uni-2019-1-figures/alg-02.png" },
    });

    expect(result.kind === "structured" && result.entry.imagePath).toBe(
      "lot-0-uni-2019-1-figures/alg-02.png",
    );
  });

  it("prefers a redrawn CeTZ figure over a crop the reader also supplied", () => {
    const result = planImageLotRestructure({
      entry: IMAGE_ENTRY,
      extracted: {
        ...EXTRACTED,
        figureCode: '#import "@preview/cetz:0.5.2": canvas, draw\n#canvas({})',
        figureImagePath: "lot-0-uni-2019-1-figures/alg-02.png",
      },
    });

    expect(result.kind === "structured" && result.entry.imagePath).toBeUndefined();
  });

  it("never keeps the whole-question crop once the statement is text", () => {
    const result = planImageLotRestructure({
      entry: IMAGE_ENTRY,
      extracted: { ...EXTRACTED, bodyTypst: "En la figura mostrada, calcule el area sombreada." },
    });

    expect(result.kind === "structured" && result.entry.imagePath).toBeUndefined();
  });

  it("accepts alternatives that are drawings, with no text to carry", () => {
    const result = planImageLotRestructure({
      entry: IMAGE_ENTRY,
      extracted: {
        bodyTypst: "¿Qué figura continúa la secuencia?",
        alternatives: ["", "", "", "", ""],
        alternativeImagePaths: [
          "lot-x-alternatives/raz-43-a.png",
          "lot-x-alternatives/raz-43-b.png",
          "lot-x-alternatives/raz-43-c.png",
          "lot-x-alternatives/raz-43-d.png",
          "lot-x-alternatives/raz-43-e.png",
        ],
      },
    });

    expect(result.kind).toBe("structured");
    expect(result.kind === "structured" && result.entry.alternativeImagePaths).toHaveLength(5);
  });

  it("still refuses a blank alternative that has no drawing behind it", () => {
    const result = planImageLotRestructure({
      entry: IMAGE_ENTRY,
      extracted: {
        bodyTypst: "¿Qué figura continúa la secuencia?",
        alternatives: ["", "", "", "", ""],
        alternativeImagePaths: [null, null, null, null, null],
      },
    });

    expect(result.kind).toBe("keep-image");
  });

  it("carries no alternative images when every option is text", () => {
    const result = planImageLotRestructure({ entry: IMAGE_ENTRY, extracted: EXTRACTED });

    expect(result.kind === "structured" && result.entry.alternativeImagePaths).toBeUndefined();
  });
});
