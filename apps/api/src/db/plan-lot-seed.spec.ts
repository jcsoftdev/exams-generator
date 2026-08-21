import { hashBodyTypst } from "../modules/bank/domain/hash-body-typst";
import { planLotSeed } from "./plan-lot-seed";

const STRUCTURED = {
  courseName: "Física",
  topicName: "Electrodinámica",
  gradeLevel: "pre",
  difficulty: "hard",
  bodyTypst: "¿A qué componente corresponde el símbolo de la figura?",
  alternatives: ["Resistencia", "Diodo", "Condensador", "Bobina"],
  correctAnswer: "1",
  sourceUrl: "https://example.test/libro.pdf",
  sourceName: "Libro de circuitos, pregunta 12",
};

const IMAGE_QUESTION = {
  courseName: "Geometría",
  topicName: "Circunferencia",
  gradeLevel: "pre",
  difficulty: "hard",
  correctAnswer: "b",
  imagePath: "lot-1-image/geo-01.png",
  sourceUrl: "https://example.test/examen.pdf",
  sourceName: "UNCP 2021-I, Geometría, pregunta 1 (clave B)",
};

describe("planLotSeed", () => {
  it("keeps a question whose statement is not in the bank yet", () => {
    const plan = planLotSeed({
      entries: [STRUCTURED],
      existingBodyHashes: new Set(),
      existingSourceNames: new Set(),
      figureFingerprints: new Map(),
    });

    expect(plan.toInsert).toHaveLength(1);
    expect(plan.skipped).toBe(0);
  });

  it("strips the booklet footer the crop left on an alternative", () => {
    const plan = planLotSeed({
      entries: [
        {
          ...STRUCTURED,
          alternatives: ["12", "15 2da. Prueba Examen de Admisión 2020-1"],
        },
      ],
      existingBodyHashes: new Set(),
      existingSourceNames: new Set(),
      figureFingerprints: new Map(),
    });

    expect(plan.toInsert[0]!.alternatives).toEqual(["12", "15"]);
  });

  it("hashes the statement as harvested, unaffected by stripping an alternative", () => {
    const plan = planLotSeed({
      entries: [{ ...STRUCTURED, alternatives: ["12", '15 Rpta. "B"'] }],
      existingBodyHashes: new Set(),
      existingSourceNames: new Set(),
      figureFingerprints: new Map(),
    });

    expect(plan.toInsert[0]!.bodyHash).toBe(hashBodyTypst(STRUCTURED.bodyTypst));
  });

  it("skips a statement already stored under the same hash", () => {
    const plan = planLotSeed({
      entries: [STRUCTURED],
      existingBodyHashes: new Set([hashBodyTypst(STRUCTURED.bodyTypst)]),
      existingSourceNames: new Set(),
      figureFingerprints: new Map(),
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.skipped).toBe(1);
  });

  it("treats one wording over two different figures as two questions", () => {
    // The whole reason the figure joins the hash: a circuits chapter asks the
    // same thing about thirteen drawings, and each drawing has its own answer.
    const withFigureA = { ...STRUCTURED, imagePath: "lot/a.png" };
    const withFigureB = { ...STRUCTURED, imagePath: "lot/b.png", correctAnswer: "2" };

    const plan = planLotSeed({
      entries: [withFigureA, withFigureB],
      existingBodyHashes: new Set(),
      existingSourceNames: new Set(),
      figureFingerprints: new Map([
        ["lot/a.png", "a".repeat(64)],
        ["lot/b.png", "b".repeat(64)],
      ]),
    });

    expect(plan.toInsert).toHaveLength(2);
    expect(plan.toInsert[0]?.bodyHash).not.toBe(plan.toInsert[1]?.bodyHash);
  });

  it("does not let two entries of the same batch collide on one hash", () => {
    const plan = planLotSeed({
      entries: [STRUCTURED, { ...STRUCTURED, sourceName: "otra fuente" }],
      existingBodyHashes: new Set(),
      existingSourceNames: new Set(),
      figureFingerprints: new Map(),
    });

    expect(plan.toInsert).toHaveLength(1);
    expect(plan.skipped).toBe(1);
  });

  it("carries the image question through with its letter answer and no bodyHash", () => {
    const plan = planLotSeed({
      entries: [IMAGE_QUESTION],
      existingBodyHashes: new Set(),
      existingSourceNames: new Set(),
      figureFingerprints: new Map(),
    });

    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0]).toMatchObject({
      type: "image",
      correctAnswer: "b",
      imagePath: "lot-1-image/geo-01.png",
    });
    expect(plan.toInsert[0]?.bodyHash).toBeUndefined();
  });

  it("skips an image question already seeded, matched on its source name", () => {
    // Image questions have no statement to hash, so re-running the boot seeder
    // would duplicate every one of them without this.
    const plan = planLotSeed({
      entries: [IMAGE_QUESTION],
      existingBodyHashes: new Set(),
      existingSourceNames: new Set([IMAGE_QUESTION.sourceName]),
      figureFingerprints: new Map(),
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.skipped).toBe(1);
  });

  it("rejects an entry that names no source, since nothing could dedupe it later", () => {
    const plan = planLotSeed({
      entries: [{ ...IMAGE_QUESTION, sourceName: "" }],
      existingBodyHashes: new Set(),
      existingSourceNames: new Set(),
      figureFingerprints: new Map(),
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.invalid).toHaveLength(1);
  });
});
