import { Difficulty } from "@exams-generator/shared";
import { resolveDifficultyFromSourceLevel } from "./resolve-difficulty-from-source-level";

describe("resolveDifficultyFromSourceLevel", () => {
  it.each([
    ["P.B.", Difficulty.Easy],
    ["P.I.", Difficulty.Medium],
    ["P.A.", Difficulty.Hard],
  ])("maps the real seeded UNCP NIVEL %s to %s", (sourceLevel, expected) => {
    expect(resolveDifficultyFromSourceLevel(sourceLevel)).toBe(expected);
  });

  it("returns undefined for null (UNI rows have no NIVEL granularity)", () => {
    expect(resolveDifficultyFromSourceLevel(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(resolveDifficultyFromSourceLevel(undefined)).toBeUndefined();
  });

  it("returns undefined for an unrecognized raw value instead of throwing", () => {
    // A future university's source data may use a different NIVEL vocabulary
    // — the resolver should degrade to "no difficulty filter", not crash.
    expect(resolveDifficultyFromSourceLevel("N/A")).toBeUndefined();
  });
});
