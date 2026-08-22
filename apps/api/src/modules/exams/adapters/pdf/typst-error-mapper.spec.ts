import { mapCompileErrorToQuestionId } from "./typst-error-mapper";

describe("mapCompileErrorToQuestionId", () => {
  it("returns the id of the question whose marker precedes the failing line", () => {
    const typstSource = [
      "#set page(columns: 2)",
      "",
      "// q:q1",
      '#image("/fixtures/q1.png", width: 100%)',
      "",
      "// q:q2",
      '#image("/fixtures/missing.png", width: 100%)',
    ].join("\n");
    // The image() call for q2 is on line 7 (1-based).
    const stderr = [
      "error: file not found (searched at /fixtures/missing.png)",
      "  ┌─ input.typ:7:8",
      "   │",
      '7 │ #image("/fixtures/missing.png", width: 100%)',
    ].join("\n");

    expect(mapCompileErrorToQuestionId(typstSource, stderr)).toBe("q2");
  });

  it("maps a different failing line to a different question id (triangulation)", () => {
    const typstSource = [
      "#set page(columns: 2)",
      "",
      "// q:q1",
      '#image("/fixtures/missing.png", width: 100%)',
      "",
      "// q:q2",
      '#image("/fixtures/q2.png", width: 100%)',
    ].join("\n");
    // The image() call for q1 is on line 4 (1-based).
    const stderr = ["error: file not found (searched at /fixtures/missing.png)", "  ┌─ input.typ:4:8"].join(
      "\n",
    );

    expect(mapCompileErrorToQuestionId(typstSource, stderr)).toBe("q1");
  });

  it("returns undefined when stderr has no traceable input.typ line reference", () => {
    const typstSource = '// q:q1\n#image("/fixtures/q1.png")';
    const stderr = "error: something went wrong (no location info)";

    expect(mapCompileErrorToQuestionId(typstSource, stderr)).toBeUndefined();
  });

  it("returns undefined when the failing line is before any question marker", () => {
    const typstSource = [
      "#set page(columns: 2)", // line 1 — syntax error here, no marker above it
      "// q:q1",
      '#image("/fixtures/q1.png")',
    ].join("\n");
    const stderr = "error: bad syntax\n  ┌─ input.typ:1:1";

    expect(mapCompileErrorToQuestionId(typstSource, stderr)).toBeUndefined();
  });
});
