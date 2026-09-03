import { MAX_FOLDER_NAME_LENGTH } from "@exams-generator/shared";
import { buildSeedFolderPlan, SeedCourseRow, SeedTopicRow } from "./build-seed-folder-plan";

const COURSES: SeedCourseRow[] = [
  { id: "c-mat-col", name: "Matemática", stage: "colegio" },
  { id: "c-com-col", name: "Comunicación", stage: "colegio" },
  { id: "c-tri-pre", name: "Trigonometría", stage: "preuniversitario" },
];

const TOPICS: SeedTopicRow[] = [
  { id: "t-1", courseId: "c-mat-col", name: "Trigonometría", gradeLevel: "secundaria_4" },
  { id: "t-2", courseId: "c-mat-col", name: "Trigonometría", gradeLevel: "secundaria_5" },
  { id: "t-3", courseId: "c-com-col", name: "Comprensión lectora", gradeLevel: null },
  { id: "t-4", courseId: "c-tri-pre", name: "Longitud de arco", gradeLevel: "pre" },
];

describe("buildSeedFolderPlan", () => {
  it("creates one root per stage that actually has courses, in school-progression order", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const roots = plan.filter((node) => node.parentKey === null);

    // No `escuela` course in the fixture -> no "Escuela" root at all.
    expect(roots.map((r) => [r.name, r.position])).toEqual([
      ["Colegio", 0],
      ["Preuniversitario", 1],
    ]);
  });

  it("puts one folder per course under its stage root, alphabetically", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const colegioKey = plan.find((node) => node.name === "Colegio")!.key;
    const courses = plan.filter((node) => node.parentKey === colegioKey);

    expect(courses.map((c) => [c.name, c.position])).toEqual([
      ["Comunicación", 0],
      ["Matemática", 1],
    ]);
    expect(courses.every((c) => c.topicId === null)).toBe(true);
  });

  it("puts one folder per topic under its course, carrying topicId and the grade suffix", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const matKey = plan.find((node) => node.name === "Matemática")!.key;
    const topics = plan.filter((node) => node.parentKey === matKey);

    expect(topics).toEqual([
      expect.objectContaining({ name: "Trigonometría · 4° secundaria", topicId: "t-1", position: 0 }),
      expect.objectContaining({ name: "Trigonometría · 5° secundaria", topicId: "t-2", position: 1 }),
    ]);
  });

  it("leaves a topic whose name is unique in its course bare", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    expect(plan.find((node) => node.topicId === "t-3")!.name).toBe("Comprensión lectora");
  });

  it("gives every node a unique key, so the repository can wire parents before ids exist", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    expect(new Set(plan.map((node) => node.key)).size).toBe(plan.length);
  });

  it("emits parents before children — the repository inserts in plan order", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const seen = new Set<string>();
    for (const node of plan) {
      if (node.parentKey !== null) {
        expect(seen.has(node.parentKey)).toBe(true);
      }
      seen.add(node.key);
    }
  });

  it("returns an empty plan when there are no courses", () => {
    expect(buildSeedFolderPlan([], [])).toEqual([]);
  });

  it("disambiguates two NULL-grade topics that share a name in the same course", () => {
    // `topics_course_id_name_grade_idx` treats every NULL grade as distinct,
    // so the taxonomy allows this row pair even though `folderNameForTopic`
    // has no grade to suffix either one with.
    const courses: SeedCourseRow[] = [{ id: "c-1", name: "Curso Duplicado", stage: "colegio" }];
    const topics: SeedTopicRow[] = [
      { id: "t-1", courseId: "c-1", name: "Repaso", gradeLevel: null },
      { id: "t-2", courseId: "c-1", name: "Repaso", gradeLevel: null },
    ];

    const plan = buildSeedFolderPlan(courses, topics);
    const topicNodes = plan.filter((node) => node.topicId !== null);

    expect(topicNodes.map((node) => node.name)).toEqual(["Repaso", "Repaso (2)"]);
    // Still two distinct rows, each carrying its own topicId — disambiguation
    // is cosmetic (the name), not a merge.
    expect(topicNodes.map((node) => node.topicId)).toEqual(["t-1", "t-2"]);
  });

  it("truncates a course name longer than MAX_FOLDER_NAME_LENGTH", () => {
    const longName = "Curso ".repeat(20); // 120 chars
    const courses: SeedCourseRow[] = [{ id: "c-1", name: longName, stage: "colegio" }];

    const plan = buildSeedFolderPlan(courses, []);
    const courseNode = plan.find((node) => node.parentKey !== null)!;

    expect(courseNode.name.length).toBeLessThanOrEqual(MAX_FOLDER_NAME_LENGTH);
    expect(courseNode.name).toBe(longName.slice(0, MAX_FOLDER_NAME_LENGTH).trim());
  });
});
