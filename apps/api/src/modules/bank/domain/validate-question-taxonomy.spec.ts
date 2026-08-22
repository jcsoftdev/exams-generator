import { validateQuestionTaxonomy } from "./validate-question-taxonomy";

describe("validateQuestionTaxonomy", () => {
  it("accepts an empty patch (nothing to change)", () => {
    expect(validateQuestionTaxonomy({})).toEqual({ ok: true });
  });
  it("rejects a blank topicId", () => {
    const r = validateQuestionTaxonomy({ topicId: "  " });
    expect(r.ok).toBe(false);
  });
  it("rejects an invalid difficulty", () => {
    const r = validateQuestionTaxonomy({ difficulty: "trivial" });
    expect(r.ok).toBe(false);
  });
  it("rejects a gradeLevel outside the catalog", () => {
    const r = validateQuestionTaxonomy({ gradeLevel: "not-a-real-grade" });
    expect(r.ok).toBe(false);
  });
  it("accepts a valid catalog gradeLevel", () => {
    expect(validateQuestionTaxonomy({ gradeLevel: "primaria_1" })).toEqual({ ok: true });
  });
  it("accepts valid fields", () => {
    expect(validateQuestionTaxonomy({ topicId: "t1", difficulty: "easy", gradeLevel: "primaria_1" })).toEqual(
      {
        ok: true,
      },
    );
  });
});
