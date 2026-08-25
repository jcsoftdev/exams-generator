import { applyLotTranscriptions } from "./apply-lot-transcriptions";
import { LotEntry } from "./plan-lot-seed";

const imageEntry = (n: number, over: Partial<LotEntry> = {}): LotEntry => ({
  courseName: "Álgebra",
  topicName: "Funciones",
  gradeLevel: "pre",
  difficulty: "hard",
  correctAnswer: "c",
  imagePath: `lot-x-image/alg-${n}.png`,
  sourceUrl: "https://admision.uni.edu.pe/solucionario2019.pdf",
  sourceName: `UNI — Álgebra, pregunta ${n} (clave C)`,
  ...over,
});

const READ = {
  bodyTypst: "Si $A subset RR$ determine el conjunto $A$.",
  alternatives: ["$(-1; 2]$", "$(-3; -sqrt(5)]$", "$(-4; -2]$", "$(-2; -1]$", "$[-3; sqrt(5)]$"],
};

describe("applyLotTranscriptions", () => {
  it("promotes an entry whose crop was transcribed", () => {
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [{ imagePath: "lot-x-image/alg-1.png", ...READ }],
    });

    expect(result.structuredEntries).toHaveLength(1);
    expect(result.imageEntries).toHaveLength(0);
    expect(result.structuredEntries[0]!.bodyTypst).toBe(READ.bodyTypst);
  });

  it("appends promotions after the structured entries the lot already had", () => {
    const existing: LotEntry = { ...imageEntry(9), bodyTypst: "ya estaba", alternatives: ["a", "b"] };

    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [existing],
      transcriptions: [{ imagePath: "lot-x-image/alg-1.png", ...READ }],
    });

    expect(result.structuredEntries.map((e) => e.bodyTypst)).toEqual(["ya estaba", READ.bodyTypst]);
  });

  it("leaves an entry nobody transcribed exactly where it was", () => {
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1), imageEntry(2)],
      structuredEntries: [],
      transcriptions: [{ imagePath: "lot-x-image/alg-1.png", ...READ }],
    });

    expect(result.imageEntries.map((e) => e.imagePath)).toEqual(["lot-x-image/alg-2.png"]);
    expect(result.reasons).toHaveLength(0);
  });

  it("keeps an entry the reader marked unreadable, and says who said so", () => {
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [{ imagePath: "lot-x-image/alg-1.png", unreadable: "el recorte corta el enunciado" }],
    });

    expect(result.imageEntries).toHaveLength(1);
    expect(result.reasons).toEqual(["UNI — Álgebra, pregunta 1 (clave C): el recorte corta el enunciado"]);
  });

  it("keeps an entry whose transcription does not survive the planner", () => {
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [{ imagePath: "lot-x-image/alg-1.png", ...READ, alternatives: ["1", "2", "3", "4"] }],
    });

    expect(result.imageEntries).toHaveLength(1);
    expect(result.reasons[0]).toContain("4 alternatives");
  });

  it("reports a transcription that matches no entry in the lot", () => {
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [{ imagePath: "lot-x-image/does-not-exist.png", ...READ }],
    });

    expect(result.unmatched).toEqual(["lot-x-image/does-not-exist.png"]);
  });

  it("refuses two transcriptions claiming the same crop", () => {
    expect(() =>
      applyLotTranscriptions({
        imageEntries: [imageEntry(1)],
        structuredEntries: [],
        transcriptions: [
          { imagePath: "lot-x-image/alg-1.png", ...READ },
          { imagePath: "lot-x-image/alg-1.png", ...READ },
        ],
      }),
    ).toThrow(/lot-x-image\/alg-1\.png/);
  });

  it("is idempotent: re-applying the same file promotes nothing a second time", () => {
    const first = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [{ imagePath: "lot-x-image/alg-1.png", ...READ }],
    });
    const second = applyLotTranscriptions({
      imageEntries: first.imageEntries,
      structuredEntries: first.structuredEntries,
      transcriptions: [{ imagePath: "lot-x-image/alg-1.png", ...READ }],
    });

    expect(second.structuredEntries).toHaveLength(1);
    expect(second.unmatched).toEqual(["lot-x-image/alg-1.png"]);
  });

  it("turns a figure crop into a job and points the entry at its output", () => {
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [
        {
          imagePath: "lot-x-image/alg-1.png",
          ...READ,
          figureCrop: { left: 0.3, top: 0.2, right: 0.75, bottom: 0.66 },
        },
      ],
    });

    expect(result.structuredEntries[0]!.imagePath).toBe("lot-x-figures/alg-1.png");
    expect(result.figureCrops).toEqual([
      {
        source: "lot-x-image/alg-1.png",
        target: "lot-x-figures/alg-1.png",
        box: { left: 0.3, top: 0.2, right: 0.75, bottom: 0.66 },
      },
    ]);
  });

  it("asks for no crop when the reader redrew the figure in CeTZ", () => {
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [
        {
          imagePath: "lot-x-image/alg-1.png",
          ...READ,
          figureCode: "#canvas({})",
          figureCrop: { left: 0.3, top: 0.2, right: 0.75, bottom: 0.66 },
        },
      ],
    });

    expect(result.figureCrops).toEqual([]);
    expect(result.structuredEntries[0]!.imagePath).toBeUndefined();
  });

  it("refuses a crop box that is not inside the image", () => {
    expect(() =>
      applyLotTranscriptions({
        imageEntries: [imageEntry(1)],
        structuredEntries: [],
        transcriptions: [
          {
            imagePath: "lot-x-image/alg-1.png",
            ...READ,
            figureCrop: { left: 0.8, top: 0.2, right: 0.4, bottom: 0.66 },
          },
        ],
      }),
    ).toThrow(/lot-x-image\/alg-1\.png/);
  });

  it("asks for no crop when the transcription itself was rejected", () => {
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [
        {
          imagePath: "lot-x-image/alg-1.png",
          ...READ,
          alternatives: ["1", "2", "3", "4"],
          figureCrop: { left: 0.3, top: 0.2, right: 0.75, bottom: 0.66 },
        },
      ],
    });

    expect(result.figureCrops).toEqual([]);
    expect(result.imageEntries).toHaveLength(1);
  });

  it("cuts one image per alternative and points each slot at its own file", () => {
    const box = (top: number) => ({ left: 0.1, top, right: 0.3, bottom: top + 0.1 });
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [
        {
          imagePath: "lot-x-image/alg-1.png",
          bodyTypst: "¿Qué figura continúa la secuencia?",
          alternatives: ["", "", "", "", ""],
          alternativeCrops: [box(0.1), box(0.2), box(0.3), box(0.4), box(0.5)],
        },
      ],
    });

    expect(result.structuredEntries[0]!.alternativeImagePaths).toEqual([
      "lot-x-alternatives/alg-1-a.png",
      "lot-x-alternatives/alg-1-b.png",
      "lot-x-alternatives/alg-1-c.png",
      "lot-x-alternatives/alg-1-d.png",
      "lot-x-alternatives/alg-1-e.png",
    ]);
    expect(result.figureCrops).toHaveLength(5);
  });

  it("leaves a text alternative without an image when its slot has no box", () => {
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [
        {
          imagePath: "lot-x-image/alg-1.png",
          bodyTypst: "¿Cuál corresponde?",
          alternatives: ["ninguna", "", "c", "", "e"],
          alternativeCrops: [
            null,
            { left: 0.1, top: 0.2, right: 0.3, bottom: 0.3 },
            null,
            { left: 0.4, top: 0.2, right: 0.6, bottom: 0.3 },
            null,
          ],
        },
      ],
    });

    expect(result.structuredEntries[0]!.alternativeImagePaths).toEqual([
      null,
      "lot-x-alternatives/alg-1-b.png",
      null,
      "lot-x-alternatives/alg-1-d.png",
      null,
    ]);
    expect(result.figureCrops).toHaveLength(2);
  });

  it("refuses an alternative box that is not a rectangle inside the image", () => {
    expect(() =>
      applyLotTranscriptions({
        imageEntries: [imageEntry(1)],
        structuredEntries: [],
        transcriptions: [
          {
            imagePath: "lot-x-image/alg-1.png",
            bodyTypst: "¿Cuál corresponde?",
            alternatives: ["", "b", "c", "d", "e"],
            alternativeCrops: [{ left: 0.5, top: 0.2, right: 0.1, bottom: 0.3 }],
          },
        ],
      }),
    ).toThrow(/lot-x-image\/alg-1\.png/);
  });

  it("cuts nothing for alternatives when the transcription was rejected", () => {
    const result = applyLotTranscriptions({
      imageEntries: [imageEntry(1)],
      structuredEntries: [],
      transcriptions: [
        {
          imagePath: "lot-x-image/alg-1.png",
          bodyTypst: "¿Cuál corresponde?",
          alternatives: ["", "", "", ""],
          alternativeCrops: [
            { left: 0.1, top: 0.2, right: 0.3, bottom: 0.3 },
            { left: 0.1, top: 0.3, right: 0.3, bottom: 0.4 },
            { left: 0.1, top: 0.4, right: 0.3, bottom: 0.5 },
            { left: 0.1, top: 0.5, right: 0.3, bottom: 0.6 },
          ],
        },
      ],
    });

    expect(result.figureCrops).toEqual([]);
    expect(result.imageEntries).toHaveLength(1);
  });
});
