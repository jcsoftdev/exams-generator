import { Difficulty } from "@exams-generator/shared";
import { GRADE_LEVELS, GradeLevel, isGradeLevel } from "./grade-level";

describe("GradeLevel", () => {
  it("is a fixed seeded catalog of exactly 12 values: 6 primaria + 5 secundaria + 1 pre", () => {
    expect(GRADE_LEVELS).toHaveLength(12);

    const primaria = GRADE_LEVELS.filter((g) => g.startsWith("primaria_"));
    const secundaria = GRADE_LEVELS.filter((g) => g.startsWith("secundaria_"));

    expect(primaria).toHaveLength(6);
    expect(secundaria).toHaveLength(5);
    expect(GRADE_LEVELS).toContain("pre");
  });

  it("has no duplicate entries", () => {
    expect(new Set(GRADE_LEVELS).size).toBe(GRADE_LEVELS.length);
  });

  describe("isGradeLevel", () => {
    it("returns true for every catalog value", () => {
      for (const value of GRADE_LEVELS) {
        expect(isGradeLevel(value)).toBe(true);
      }
    });

    it("returns false for values outside the seeded catalog", () => {
      expect(isGradeLevel("6to_universidad")).toBe(false);
      expect(isGradeLevel("")).toBe(false);
      expect(isGradeLevel("easy")).toBe(false);
    });
  });

  describe("independence from Difficulty (grade_level and difficulty are separate axes)", () => {
    it("every GradeLevel value can be paired with every Difficulty value — no combination is rejected", () => {
      const difficulties = Object.values(Difficulty);
      const combinations: { gradeLevel: GradeLevel; difficulty: Difficulty }[] = [];

      for (const gradeLevel of GRADE_LEVELS) {
        for (const difficulty of difficulties) {
          combinations.push({ gradeLevel, difficulty });
        }
      }

      expect(combinations).toHaveLength(GRADE_LEVELS.length * difficulties.length);
      for (const combo of combinations) {
        expect(isGradeLevel(combo.gradeLevel)).toBe(true);
        expect(difficulties).toContain(combo.difficulty);
      }
    });

    it("changing the difficulty does not change which grade levels are valid, and vice versa", () => {
      const validGradeLevelsForEasy = GRADE_LEVELS.filter((g) => isGradeLevel(g));
      const validGradeLevelsForHard = GRADE_LEVELS.filter((g) => isGradeLevel(g));

      expect(validGradeLevelsForEasy).toEqual(validGradeLevelsForHard);
    });
  });
});
