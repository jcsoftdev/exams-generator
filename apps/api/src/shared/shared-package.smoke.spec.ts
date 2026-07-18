import { Role, Difficulty } from "@exams-generator/shared";

describe("packages/shared path mapping (api)", () => {
  it("resolves the Role enum via @exams-generator/shared", () => {
    expect(Role.Teacher).toBe("teacher");
  });

  it("resolves the Difficulty enum via @exams-generator/shared", () => {
    expect(Difficulty.Medium).toBe("medium");
  });
});
