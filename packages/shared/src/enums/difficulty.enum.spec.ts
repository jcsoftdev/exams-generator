import { Difficulty } from "./difficulty.enum";

// Same reasoning as role.enum.spec.ts: `Difficulty` values are stored and
// compared as raw strings (question metadata, exam generation filters), so
// a silent rename here is a data-compatibility break, not a cosmetic one.
describe("Difficulty", () => {
  it("keeps its member set stable", () => {
    expect(Object.keys(Difficulty)).toEqual(["Easy", "Medium", "Hard"]);
  });

  it.each([
    [Difficulty.Easy, "easy"],
    [Difficulty.Medium, "medium"],
    [Difficulty.Hard, "hard"],
  ])("%s serializes to %j", (member, value) => {
    expect(member).toBe(value);
  });
});
