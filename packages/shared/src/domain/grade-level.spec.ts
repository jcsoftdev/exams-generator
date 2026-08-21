import { GRADE_LEVELS, GradeLevel, STAGES, isGradeLevel, isStage, stageForGrade } from "./grade-level";

describe("GRADE_LEVELS", () => {
  it("is the fixed catalog of 12: six primaria, five secundaria, one pre", () => {
    expect(GRADE_LEVELS).toHaveLength(12);
    expect(GRADE_LEVELS.filter((g) => g.startsWith("primaria_"))).toHaveLength(6);
    expect(GRADE_LEVELS.filter((g) => g.startsWith("secundaria_"))).toHaveLength(5);
    expect(GRADE_LEVELS).toContain("pre");
  });

  it("has no duplicates — it is a database column's domain", () => {
    expect(new Set(GRADE_LEVELS).size).toBe(GRADE_LEVELS.length);
  });
});

describe("isGradeLevel", () => {
  it.each(GRADE_LEVELS)("accepts %s", (grade) => {
    expect(isGradeLevel(grade)).toBe(true);
  });

  it.each(["", "primaria_7", "secundaria_6", "PRE", "universidad"])("rejects %p", (value) => {
    expect(isGradeLevel(value)).toBe(false);
  });
});

describe("stageForGrade", () => {
  it("puts every grade in exactly one stage, and covers all three", () => {
    const stages = GRADE_LEVELS.map((grade) => stageForGrade(grade));

    expect(new Set(stages)).toEqual(new Set(STAGES));
    stages.forEach((stage) => expect(isStage(stage)).toBe(true));
  });

  it.each([
    ["primaria_1", "escuela"],
    ["primaria_6", "escuela"],
    ["secundaria_1", "colegio"],
    ["secundaria_5", "colegio"],
    ["pre", "preuniversitario"],
  ] as [GradeLevel, string][])("maps %s to %s", (grade, stage) => {
    expect(stageForGrade(grade)).toBe(stage);
  });
});
