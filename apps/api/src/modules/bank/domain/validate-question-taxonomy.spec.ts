import { validateQuestionTaxonomy } from "./validate-question-taxonomy";

describe("validateQuestionTaxonomy", () => {
  it("accepts an empty patch (nothing to change)", () => {
    expect(validateQuestionTaxonomy({})).toEqual({ ok: true });
  });
  it("rejects a blank courseId", () => {
    const r = validateQuestionTaxonomy({ courseId: "  " });
    expect(r.ok).toBe(false);
  });
  it("rejects an invalid difficulty", () => {
    const r = validateQuestionTaxonomy({ difficulty: "trivial" });
    expect(r.ok).toBe(false);
  });
  it("accepts valid fields", () => {
    expect(validateQuestionTaxonomy({ courseId: "c1", topicId: "t1", difficulty: "easy", gradeLevel: "pre" })).toEqual({ ok: true });
  });
});
