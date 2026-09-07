import { planImageQuestionRetirement } from "./plan-image-question-retirement";

/**
 * The restructure pass promotes a harvested lot's whole-question PNGs to text,
 * but `seedLotQuestions` only ever INSERTS: image entries dedupe on
 * `source_name`, structured ones on `bodyHash`. So the deploy that ships a
 * restructured lot puts the text rows BESIDE the screenshots they replace, and
 * the bank shows every one of those questions twice.
 *
 * This is the decision half of the pass that clears them, kept pure so the
 * rules are testable without a database: the I/O shell only runs what it
 * returns.
 */
describe("planImageQuestionRetirement", () => {
  const source = (n: number) => `UNI — Examen de Admisión 2019-2, Matemáticas, pregunta ${n}`;

  it("retires the screenshot once its statement exists as text", () => {
    const plan = planImageQuestionRetirement({
      imageRows: [{ id: "img-1", sourceName: source(1) }],
      textRows: [{ id: "txt-1", sourceName: source(1) }],
    });

    expect(plan.retire).toEqual([{ imageId: "img-1", textId: "txt-1" }]);
    expect(plan.skipped).toEqual([]);
  });

  it("leaves a question that deliberately stays an image", () => {
    // Matemáticas 20 keeps its crop: its five alternatives are graphs the
    // harvest never captured, so it has no text twin to hand over to.
    const plan = planImageQuestionRetirement({
      imageRows: [{ id: "img-20", sourceName: source(20) }],
      textRows: [{ id: "txt-1", sourceName: source(1) }],
    });

    expect(plan.retire).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  /**
   * Two text rows for one `source_name` means the bank already holds a
   * duplicate this pass did not create. Picking either to inherit the exam
   * references would bake a coin flip into somebody's exam, so it reports the
   * collision and touches nothing.
   */
  it("refuses to choose when one source name has two text rows", () => {
    const plan = planImageQuestionRetirement({
      imageRows: [{ id: "img-1", sourceName: source(1) }],
      textRows: [
        { id: "txt-a", sourceName: source(1) },
        { id: "txt-b", sourceName: source(1) },
      ],
    });

    expect(plan.retire).toEqual([]);
    expect(plan.skipped).toEqual([
      { sourceName: source(1), reason: "2 filas de texto comparten este source_name" },
    ]);
  });

  it("handles a whole lot at once, pairing each question with its own text row", () => {
    const plan = planImageQuestionRetirement({
      imageRows: [
        { id: "img-1", sourceName: source(1) },
        { id: "img-2", sourceName: source(2) },
        { id: "img-20", sourceName: source(20) },
      ],
      textRows: [
        { id: "txt-2", sourceName: source(2) },
        { id: "txt-1", sourceName: source(1) },
      ],
    });

    expect(plan.retire).toEqual([
      { imageId: "img-1", textId: "txt-1" },
      { imageId: "img-2", textId: "txt-2" },
    ]);
  });

  /**
   * UNAC reuses items between its own exams, so the restructure of a second lot
   * writes a statement the bank already holds from the first. The seeder dedupes
   * those on `bodyHash` and inserts nothing, which leaves the second lot's
   * screenshot with no text row of its own `source_name` — and, before this,
   * unretirable forever. 44 questions were stuck exactly there.
   *
   * The twin is the row that statement already has under the other lot's name.
   */
  it("retires a screenshot whose statement was already seeded under another lot's source name", () => {
    const plan = planImageQuestionRetirement({
      imageRows: [{ id: "img-15", sourceName: source(15) }],
      textRows: [{ id: "txt-otro-lote", sourceName: "UNAC — Cuarto Examen 2022-I, pregunta 2" }],
      twinTextIdBySourceName: new Map([[source(15), "txt-otro-lote"]]),
    });

    expect(plan.retire).toEqual([{ imageId: "img-15", textId: "txt-otro-lote" }]);
    expect(plan.skipped).toEqual([]);
  });

  it("prefers the row that carries the screenshot's own source name over the twin", () => {
    const plan = planImageQuestionRetirement({
      imageRows: [{ id: "img-1", sourceName: source(1) }],
      textRows: [{ id: "txt-1", sourceName: source(1) }],
      twinTextIdBySourceName: new Map([[source(1), "txt-otro-lote"]]),
    });

    expect(plan.retire).toEqual([{ imageId: "img-1", textId: "txt-1" }]);
  });

  /**
   * The twin is a fallback, not a licence to guess: a `source_name` its own lot
   * still lists as an image has nothing to hand over to, twin map or not.
   */
  it("ignores a twin for a question no lot has promoted", () => {
    const plan = planImageQuestionRetirement({
      imageRows: [{ id: "img-20", sourceName: source(20) }],
      textRows: [{ id: "txt-1", sourceName: source(1) }],
      twinTextIdBySourceName: new Map([[source(1), "txt-1"]]),
    });

    expect(plan.retire).toEqual([]);
  });

  it("ignores a row with no source name, which nothing could pair on", () => {
    const plan = planImageQuestionRetirement({
      imageRows: [{ id: "img-1", sourceName: null }],
      textRows: [{ id: "txt-1", sourceName: null }],
    });

    expect(plan.retire).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("does nothing on a bank that was never restructured", () => {
    expect(planImageQuestionRetirement({ imageRows: [], textRows: [] })).toEqual({
      retire: [],
      skipped: [],
    });
  });
});
