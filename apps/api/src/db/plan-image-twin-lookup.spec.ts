import { planImageTwinLookup } from "./plan-image-twin-lookup";

/**
 * UNAC repeats items between its own exams, so restructuring a second lot writes
 * statements the bank already holds from the first. `seedLotQuestions` dedupes
 * those on `bodyHash` and inserts nothing, which leaves the second lot's
 * screenshot with no text row of its own `source_name` — and so unretirable,
 * however many times the deploy runs. 44 questions sat there.
 *
 * This picks the screenshots in that situation and says which statement hash to
 * look the twin up by, so the shell queries for those and nothing else: in the
 * steady state the list is empty and the extra select never runs.
 */
describe("planImageTwinLookup", () => {
  const source = (n: number) => `UNAC — Cuarto Examen 2022-I, Física, pregunta ${n}`;

  it("asks for the hash of a screenshot its lot promoted but the seeder deduped away", () => {
    const lookup = planImageTwinLookup({
      promotedHashBySourceName: new Map([[source(2), "hash-histograma"]]),
      imageRows: [{ id: "img-2", sourceName: source(2) }],
      textRows: [],
    });

    expect(lookup).toEqual([{ sourceName: source(2), bodyHash: "hash-histograma" }]);
  });

  it("asks for nothing when the screenshot already has a text row of its own name", () => {
    const lookup = planImageTwinLookup({
      promotedHashBySourceName: new Map([[source(2), "hash-histograma"]]),
      imageRows: [{ id: "img-2", sourceName: source(2) }],
      textRows: [{ id: "txt-2", sourceName: source(2) }],
    });

    expect(lookup).toEqual([]);
  });

  /**
   * A question its lot still lists as an image was never promoted, so there is
   * no statement to look up and nothing about it is superseded.
   */
  it("asks for nothing about a question that is still an image in its lot", () => {
    const lookup = planImageTwinLookup({
      promotedHashBySourceName: new Map(),
      imageRows: [{ id: "img-20", sourceName: source(20) }],
      textRows: [],
    });

    expect(lookup).toEqual([]);
  });

  it("ignores a screenshot with no provenance, which no lot entry can name", () => {
    const lookup = planImageTwinLookup({
      promotedHashBySourceName: new Map([[source(2), "hash-histograma"]]),
      imageRows: [{ id: "img-x", sourceName: null }],
      textRows: [],
    });

    expect(lookup).toEqual([]);
  });

  it("asks for each hash once, however many screenshots share a statement", () => {
    const lookup = planImageTwinLookup({
      promotedHashBySourceName: new Map([
        [source(2), "hash-histograma"],
        [source(9), "hash-histograma"],
      ]),
      imageRows: [
        { id: "img-2", sourceName: source(2) },
        { id: "img-9", sourceName: source(9) },
      ],
      textRows: [],
    });

    expect(lookup.map((item) => item.sourceName).sort()).toEqual([source(2), source(9)].sort());
    expect(new Set(lookup.map((item) => item.bodyHash)).size).toBe(1);
  });

  it("asks for nothing on a bank whose lots were never restructured", () => {
    expect(planImageTwinLookup({ promotedHashBySourceName: new Map(), imageRows: [], textRows: [] })).toEqual(
      [],
    );
  });
});
