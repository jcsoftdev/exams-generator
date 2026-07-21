import { Difficulty } from "@exams-generator/shared";
import { resolveBlueprint, TemplateRow, SyllabusEntry } from "./resolve-blueprint";

const ARITMETICA = "course-aritmetica";
const ALGEBRA = "course-algebra";
const COMUNICACION = "course-comunicacion";

describe("resolveBlueprint", () => {
  describe("courseScope='none' (manual)", () => {
    it("always returns no rows — manual creation never uses a template", () => {
      const result = resolveBlueprint({
        courseScope: "none",
        weekScope: "none",
        templateRows: [{ courseId: ARITMETICA, questionCount: 12 }],
        syllabus: [],
      });
      expect(result).toEqual([]);
    });
  });

  describe("weekScope='none' (eta) — course-level rows, no topic expansion", () => {
    it("emits one course-level row per template row when questionCount is known", () => {
      const templateRows: TemplateRow[] = [
        { courseId: ARITMETICA, questionCount: 12, sourceLevel: "P.A." },
        { courseId: ALGEBRA, questionCount: 8, sourceLevel: "P.I." },
      ];
      const result = resolveBlueprint({ courseScope: "all", weekScope: "none", templateRows, syllabus: [] });

      expect(result).toEqual([
        { courseId: ARITMETICA, count: 12, difficulty: Difficulty.Hard },
        { courseId: ALGEBRA, count: 8, difficulty: Difficulty.Medium },
      ]);
    });

    it("omits `difficulty` when sourceLevel is absent (UNI rows)", () => {
      const templateRows: TemplateRow[] = [{ courseId: ARITMETICA, questionCount: 5 }];
      const [row] = resolveBlueprint({ courseScope: "all", weekScope: "none", templateRows, syllabus: [] });
      expect(row.difficulty).toBeUndefined();
    });

    it("courseScope='selected' filters to only the chosen courses", () => {
      const templateRows: TemplateRow[] = [
        { courseId: ARITMETICA, questionCount: 12 },
        { courseId: ALGEBRA, questionCount: 8 },
        { courseId: COMUNICACION, questionCount: 6 },
      ];
      const result = resolveBlueprint({
        courseScope: "selected",
        weekScope: "none",
        templateRows,
        syllabus: [],
        selectedCourseIds: [ALGEBRA],
      });
      expect(result).toEqual([{ courseId: ALGEBRA, count: 8, difficulty: undefined }]);
    });

    it("derives count from weightPoints proportionally when questionCount is missing (UNI case)", () => {
      // Real shape: UNI rows carry only weightPoints, split evenly by the
      // seed step across the courses in their exam section — e.g. E2 (600pts)
      // over 4 math courses = 150 each. Here two courses share weight 3:1.
      const templateRows: TemplateRow[] = [
        { courseId: ARITMETICA, weightPoints: 150 },
        { courseId: ALGEBRA, weightPoints: 50 },
      ];
      const result = resolveBlueprint({
        courseScope: "all",
        weekScope: "none",
        templateRows,
        syllabus: [],
        totalQuestionsOverride: 40,
      });
      // 150:50 = 3:1 → 30 and 10 out of 40, exact split with no remainder.
      expect(result).toEqual([
        { courseId: ARITMETICA, count: 30, difficulty: undefined },
        { courseId: ALGEBRA, count: 10, difficulty: undefined },
      ]);
    });

    it("weight-derived counts always sum EXACTLY to totalQuestionsOverride, even with remainders", () => {
      const templateRows: TemplateRow[] = [
        { courseId: ARITMETICA, weightPoints: 1 },
        { courseId: ALGEBRA, weightPoints: 1 },
        { courseId: COMUNICACION, weightPoints: 1 },
      ];
      const result = resolveBlueprint({
        courseScope: "all",
        weekScope: "none",
        templateRows,
        syllabus: [],
        totalQuestionsOverride: 10, // 10/3 each — must not silently drop to 9 or overshoot 11
      });
      expect(result.reduce((sum, row) => sum + row.count, 0)).toBe(10);
    });
  });

  describe("weekScope='current_only' (fastest) and 'cumulative' (eta_by_week) — topic expansion", () => {
    const syllabus: SyllabusEntry[] = [
      { courseId: ARITMETICA, topicId: "t-conjuntos", weekNumber: 0 },
      { courseId: ARITMETICA, topicId: "t-numeracion", weekNumber: 1 },
      { courseId: ARITMETICA, topicId: "t-divisibilidad", weekNumber: 2 },
    ];

    it("current_only: only the topic(s) mapped to exactly currentWeek", () => {
      const templateRows: TemplateRow[] = [{ courseId: ARITMETICA, questionCount: 12 }];
      const result = resolveBlueprint({
        courseScope: "selected",
        weekScope: "current_only",
        templateRows,
        syllabus,
        currentWeek: 1,
        selectedCourseIds: [ARITMETICA],
      });
      expect(result).toEqual([{ courseId: ARITMETICA, topicId: "t-numeracion", count: 12, difficulty: undefined }]);
    });

    it("cumulative: every topic from week 0 through currentWeek, same total count split across them (user decision: total size never shrinks vs. the full ETA)", () => {
      const templateRows: TemplateRow[] = [{ courseId: ARITMETICA, questionCount: 12 }];
      const result = resolveBlueprint({
        courseScope: "all",
        weekScope: "cumulative",
        templateRows,
        syllabus,
        currentWeek: 1, // weeks 0 and 1 are in scope → 2 topics
      });
      expect(result).toHaveLength(2);
      expect(result.reduce((sum, row) => sum + row.count, 0)).toBe(12);
      expect(result.map((r) => r.topicId).sort()).toEqual(["t-conjuntos", "t-numeracion"]);
    });

    it("cumulative at the final week includes every topic the syllabus has, still totalling the same course count", () => {
      const templateRows: TemplateRow[] = [{ courseId: ARITMETICA, questionCount: 12 }];
      const result = resolveBlueprint({
        courseScope: "all",
        weekScope: "cumulative",
        templateRows,
        syllabus,
        currentWeek: 99, // past the end — should clamp to whatever the syllabus actually has, not error
      });
      expect(result).toHaveLength(3);
      expect(result.reduce((sum, row) => sum + row.count, 0)).toBe(12);
    });

    it("propagates difficulty to every expanded topic row", () => {
      const templateRows: TemplateRow[] = [{ courseId: ARITMETICA, questionCount: 12, sourceLevel: "P.B." }];
      const result = resolveBlueprint({
        courseScope: "all",
        weekScope: "cumulative",
        templateRows,
        syllabus,
        currentWeek: 1,
      });
      expect(result.every((row) => row.difficulty === Difficulty.Easy)).toBe(true);
    });

    it("drops a course entirely when it has zero syllabus topics in scope (e.g. UNCP has no syllabus at all) instead of emitting a bogus row", () => {
      const templateRows: TemplateRow[] = [
        { courseId: ARITMETICA, questionCount: 12 },
        { courseId: COMUNICACION, questionCount: 6 }, // no syllabus entries for this course at all
      ];
      const result = resolveBlueprint({
        courseScope: "all",
        weekScope: "current_only",
        templateRows,
        syllabus,
        currentWeek: 0,
      });
      expect(result.every((row) => row.courseId !== COMUNICACION)).toBe(true);
    });

    it("never emits a row with count 0 even when a topic's fair share rounds down to zero", () => {
      // 12 questions is a real seeded case (Aritmética), but a small course
      // (e.g. weightPoints-derived count of 2) spread across 3 in-scope
      // topics must not silently emit a count:0 row for the "loser" topic.
      const templateRows: TemplateRow[] = [{ courseId: ARITMETICA, questionCount: 2 }];
      const threeWeekSyllabus: SyllabusEntry[] = [
        { courseId: ARITMETICA, topicId: "a", weekNumber: 0 },
        { courseId: ARITMETICA, topicId: "b", weekNumber: 1 },
        { courseId: ARITMETICA, topicId: "c", weekNumber: 2 },
      ];
      const result = resolveBlueprint({
        courseScope: "all",
        weekScope: "cumulative",
        templateRows,
        syllabus: threeWeekSyllabus,
        currentWeek: 2,
      });
      expect(result.every((row) => row.count > 0)).toBe(true);
      expect(result.reduce((sum, row) => sum + row.count, 0)).toBe(2);
      expect(result).toHaveLength(2); // only 2 of the 3 topics get a nonzero share
    });
  });
});
